-- #1038: portal messages stored result rows: inline tables, chart and map
-- rows, handle samples (`samplePeek`), and raw tool results. A reader who lost
-- access to a view kept reading them. The API now stores and serves results
-- as recipes only (`apps/api/src/services/stored-result.util.ts`); this
-- removes the rows already at rest, producing exactly what that util serves
-- (the migration test compares the two). A second run changes nothing.
--
-- The helpers live in pg_temp, so they last only for this migration's session
-- and leave nothing in the schema.
CREATE OR REPLACE FUNCTION pg_temp.stored_rows(c jsonb) RETURNS jsonb
LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE
    WHEN jsonb_typeof(c -> 'rows') = 'array' THEN c -> 'rows'
    WHEN jsonb_typeof(c -> 'sample') = 'array' THEN c -> 'sample'
    ELSE NULL
  END
$$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION pg_temp.stored_columns(c jsonb) RETURNS jsonb
LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE
    WHEN jsonb_typeof(c -> 'columns') = 'array' THEN c -> 'columns'
    WHEN jsonb_typeof(c -> 'schema') = 'array' THEN COALESCE(
      (SELECT jsonb_agg(col -> 'name' ORDER BY ord)
         FROM jsonb_array_elements(c -> 'schema') WITH ORDINALITY AS s(col, ord)
        WHERE jsonb_typeof(col -> 'name') = 'string'),
      '[]'::jsonb)
    ELSE COALESCE(
      (SELECT jsonb_agg(k)
         FROM jsonb_object_keys(
           CASE WHEN jsonb_typeof(
                  COALESCE(pg_temp.stored_rows(c), c -> 'samplePeek') -> 0
                ) = 'object'
                THEN COALESCE(pg_temp.stored_rows(c), c -> 'samplePeek') -> 0
                ELSE '{}'::jsonb END
         ) AS k),
      '[]'::jsonb)
  END
$$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION pg_temp.stored_row_count(c jsonb) RETURNS jsonb
LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE
    WHEN jsonb_typeof(c -> 'rowCount') = 'number' THEN c -> 'rowCount'
    ELSE to_jsonb(COALESCE(jsonb_array_length(pg_temp.stored_rows(c)), 0))
  END
$$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION pg_temp.has_pipeline(c jsonb) RETURNS boolean
LANGUAGE sql IMMUTABLE AS $$
  SELECT jsonb_typeof(c -> 'pipeline') = 'object'
     AND jsonb_typeof(c -> 'pipeline' -> 'sql') = 'string'
     AND length(c -> 'pipeline' ->> 'sql') > 0
     AND jsonb_typeof(c -> 'pipeline' -> 'stationId') = 'string'
     AND length(c -> 'pipeline' ->> 'stationId') > 0
     AND jsonb_typeof(c -> 'pipeline' -> 'organizationId') = 'string'
     AND length(c -> 'pipeline' ->> 'organizationId') > 0
     AND COALESCE(jsonb_typeof(c -> 'pipeline' -> 'transform'), 'object') = 'object'
$$;
--> statement-breakpoint
-- A data-table / d3 / geo block's content: its recipe, or not kept.
CREATE OR REPLACE FUNCTION pg_temp.stored_block_content(block_type text, raw jsonb)
RETURNS jsonb LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE
    WHEN c -> 'notKept' = 'true'::jsonb THEN c
    WHEN pg_temp.has_pipeline(c)
      THEN c - 'rows' - 'samplePeek' - 'sample' - 'queryHandle'
    ELSE jsonb_build_object(
      'type', block_type,
      'notKept', true,
      'columns', pg_temp.stored_columns(c),
      'rowCount', pg_temp.stored_row_count(c))
  END
  FROM (SELECT CASE WHEN jsonb_typeof(raw) = 'object' THEN raw
                    ELSE '{}'::jsonb END AS c) AS x
$$;
--> statement-breakpoint
-- A raw tool result: a row result's shape (with its handle's id), anything
-- else unchanged. A bare array is rows only when every element is an object.
CREATE OR REPLACE FUNCTION pg_temp.stored_tool_result(c jsonb) RETURNS jsonb
LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE
    WHEN jsonb_typeof(c) = 'array'
         AND jsonb_array_length(c) > 0
         AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(c) AS el(v)
                          WHERE jsonb_typeof(v) <> 'object')
      THEN jsonb_build_object(
      'rowsNotKept', true,
      'columns', COALESCE((SELECT jsonb_agg(k)
                             FROM jsonb_object_keys(c -> 0) AS k),
                          '[]'::jsonb),
      'rowCount', jsonb_array_length(c))
    WHEN jsonb_typeof(c) <> 'object' THEN c
    WHEN c -> 'rowsNotKept' = 'true'::jsonb THEN c
    WHEN pg_temp.stored_rows(c) IS NULL
         AND jsonb_typeof(c -> 'queryHandle') IS DISTINCT FROM 'string' THEN c
    ELSE jsonb_build_object(
           'rowsNotKept', true,
           'columns', pg_temp.stored_columns(c),
           'rowCount', pg_temp.stored_row_count(c))
         || CASE
              WHEN jsonb_typeof(c -> 'pipeline' -> 'sql') = 'string'
                THEN CASE WHEN length(c -> 'pipeline' ->> 'sql') > 0
                          THEN jsonb_build_object('sql', c -> 'pipeline' -> 'sql')
                          ELSE '{}'::jsonb END
              WHEN jsonb_typeof(c -> 'sql') = 'string'
                   AND length(c ->> 'sql') > 0
                THEN jsonb_build_object('sql', c -> 'sql')
              ELSE '{}'::jsonb
            END
         || CASE WHEN jsonb_typeof(c -> 'queryHandle') = 'string'
                 THEN jsonb_build_object('queryHandle', c -> 'queryHandle')
                 ELSE '{}'::jsonb END
  END
$$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION pg_temp.stored_blocks(blocks jsonb) RETURNS jsonb
LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE
    WHEN jsonb_typeof(blocks) <> 'array' THEN blocks
    ELSE COALESCE(
      (SELECT jsonb_agg(
                CASE
                  WHEN jsonb_typeof(b) <> 'object' THEN b
                  WHEN b ->> 'type' IN ('data-table', 'd3', 'geo')
                    THEN jsonb_set(b, '{content}',
                           pg_temp.stored_block_content(b ->> 'type', b -> 'content'))
                  WHEN b ->> 'type' = 'tool-result' AND b ? 'content'
                    THEN jsonb_set(b, '{content}',
                           pg_temp.stored_tool_result(b -> 'content'))
                  ELSE b
                END
                ORDER BY ord)
         FROM jsonb_array_elements(blocks) WITH ORDINALITY AS e(b, ord)),
      '[]'::jsonb)
  END
$$;
--> statement-breakpoint
-- destructive-ok: removes stored result rows; the recipe that re-runs each result is kept (#1038)
UPDATE portal_messages
SET blocks = pg_temp.stored_blocks(blocks)
WHERE blocks IS DISTINCT FROM pg_temp.stored_blocks(blocks);
