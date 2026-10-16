-- #804: give every live wide-table geometry column a GiST index.
--
-- The reconciler named an index `er__<entityId>__<columnName>_gist`, which
-- Postgres truncates to 63 bytes, so two geometry columns sharing their first
-- 21 characters got one name and the second `CREATE INDEX IF NOT EXISTS` was a
-- silent no-op. Converting a geometry column to jsonb dropped by that same
-- name, which could also take a sibling column's index.
--
-- The reconciler now names an index `er__<entityId>__<16 hex of md5(column)>_gist`
-- (`gistIndexName`, always 63 bytes, hashing the stored column name). This
-- creates that index for every live geometry column that no single-column
-- GiST index covers. Columns that have one under the old truncated name keep
-- it: it works, and the new name can't collide with it.
--
-- Only live columns of live entities: a retired column stays on disk and an
-- entity's `er__` table outlives its delete until the entity_data_delete job
-- drops it, and nothing queries either. The build blocks writes to its table
-- for the duration, so it isn't spent on data no one reads.
-- `wide_table_columns` names the column; the catalog says whether the table,
-- the column (stored truncated to 63 bytes, `left(…, 63)`) and an index exist.
-- Expand-only. Idempotent: a covered column leaves the set.
DO $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT c.relname AS table_name, a.attname AS column_name
    FROM wide_table_columns w
    JOIN connector_entities e
      ON e.id = w.connector_entity_id AND e.deleted IS NULL
    JOIN pg_namespace n ON n.nspname = 'public'
    JOIN pg_class c
      ON c.relnamespace = n.oid
      AND c.relkind = 'r'
      AND c.relname = 'er__' || w.connector_entity_id
    JOIN pg_attribute a
      ON a.attrelid = c.oid
      AND a.attname = left(w.column_name, 63)
      AND NOT a.attisdropped
    JOIN pg_type t ON t.oid = a.atttypid AND t.typname = 'geometry'
    WHERE w.deleted IS NULL
      AND w.retired_at IS NULL
      AND NOT EXISTS (
        SELECT 1
        FROM pg_index x
        JOIN pg_class i ON i.oid = x.indexrelid
        JOIN pg_am am ON am.oid = i.relam AND am.amname = 'gist'
        WHERE x.indrelid = c.oid
          AND x.indnatts = 1
          AND x.indkey[0] = a.attnum
      )
  LOOP
    EXECUTE format(
      'CREATE INDEX IF NOT EXISTS %I ON public.%I USING GIST (%I)',
      r.table_name || '__' || substr(md5(r.column_name), 1, 16) || '_gist',
      r.table_name,
      r.column_name
    );
  END LOOP;
END $$;
