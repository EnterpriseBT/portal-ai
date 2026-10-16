-- #804: give every wide-table geometry column a GiST index.
--
-- The reconciler named an index `er__<entityId>__<columnName>_gist`, which
-- Postgres truncates to 63 bytes, so two geometry columns sharing their first
-- 21 characters got one name and the second `CREATE INDEX IF NOT EXISTS` was a
-- silent no-op. Converting a geometry column to jsonb dropped by that same
-- name, which could also take a sibling column's index.
--
-- The reconciler now names an index `er__<entityId>__<16 hex of md5(column)>_gist`
-- (`gistIndexName`, always 63 bytes). This creates that index for every
-- geometry column of a `public.er__*` table that no GiST index covers.
-- Columns that have one under the old truncated name keep it: it works, and
-- the new name can't collide with it.
--
-- Driven by the catalog, not `wide_table_columns`, so it only sees tables and
-- columns that exist. Expand-only. Idempotent: a covered column leaves the set.
DO $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT c.relname AS table_name, a.attname AS column_name
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace AND n.nspname = 'public'
    JOIN pg_attribute a
      ON a.attrelid = c.oid AND a.attnum > 0 AND NOT a.attisdropped
    JOIN pg_type t ON t.oid = a.atttypid AND t.typname = 'geometry'
    WHERE c.relkind = 'r'
      AND c.relname LIKE 'er\_\_%'
      AND NOT EXISTS (
        SELECT 1
        FROM pg_index x
        JOIN pg_class i ON i.oid = x.indexrelid
        JOIN pg_am am ON am.oid = i.relam AND am.amname = 'gist'
        WHERE x.indrelid = c.oid AND a.attnum = ANY (x.indkey)
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
