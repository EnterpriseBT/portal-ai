-- Wide-table storage — Phase 2 Slice 0: add `source_id` metadata column.
--
-- Every `er__<connector_entity_id>` table grows a fifth metadata column
-- `source_id text NOT NULL UNIQUE`. The value is denormalised from
-- `entity_records.source_id` so cross-entity JOINs can hit the target
-- wide table directly (`a.source_id = d.c_account_ref`) instead of
-- bouncing through `entity_records`.
--
-- The `er__*` table set is dynamic (created by the reconciler at
-- runtime), so this migration iterates `pg_tables` rather than touching
-- any static Drizzle schema. It is safe on empty tables (Phase 1 wide
-- tables are empty — writes start in Slice 1) and backfills from
-- `entity_records.source_id` if rows are present.
--
-- Idempotent: `ADD COLUMN IF NOT EXISTS`, `CREATE UNIQUE INDEX IF NOT
-- EXISTS`, and the backfill only updates rows where `source_id IS NULL`.

DO $$
DECLARE
  t text;
  has_unique boolean;
BEGIN
  FOR t IN
    SELECT tablename
    FROM pg_tables
    WHERE schemaname = 'public'
      AND tablename LIKE 'er\_\_%'
  LOOP
    -- 1. Add column as nullable so the migration can run against
    --    populated tables without a default.
    EXECUTE format(
      'ALTER TABLE %I ADD COLUMN IF NOT EXISTS source_id text',
      t
    );

    -- 2. Backfill from entity_records for any rows already present.
    EXECUTE format(
      'UPDATE %I w SET source_id = er.source_id ' ||
      'FROM entity_records er ' ||
      'WHERE er.id = w.entity_record_id AND w.source_id IS NULL',
      t
    );

    -- 3. Enforce NOT NULL. Safe on empty tables; safe after backfill
    --    on populated tables. Will fail if a row's matching
    --    entity_records.source_id is NULL — by design.
    EXECUTE format(
      'ALTER TABLE %I ALTER COLUMN source_id SET NOT NULL',
      t
    );

    -- 4. Unique index.
    SELECT EXISTS (
      SELECT 1 FROM pg_indexes
      WHERE schemaname = 'public'
        AND indexname = t || '__source_id_unique'
    ) INTO has_unique;
    IF NOT has_unique THEN
      EXECUTE format(
        'CREATE UNIQUE INDEX %I ON %I (source_id)',
        t || '__source_id_unique',
        t
      );
    END IF;
  END LOOP;
END $$;
