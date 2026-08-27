-- #450 cause 1: carry soft-delete state on every wide table so the portal
-- session view can filter locally instead of joining `entity_records`.
--
-- Wide tables (`er__<entityId>`) are created dynamically by
-- WideTableReconcilerService, not by the Drizzle schema, so this is a
-- hand-written data migration that loops over every existing wide table.
-- New tables get the column from `ensureTable`; this covers the existing ones.
--
-- For each `er__%` table:
--   1. ADD COLUMN "deleted" bigint IF NOT EXISTS (nullable; NULL = live).
--   2. Backfill from `entity_records.deleted` for any row whose record is
--      already soft-deleted. Live rows dominate (soft-deletes were physically
--      deleted from the wide side before this change), so this is mostly a
--      no-op — but it closes any pre-existing best-effort-cascade orphan
--      window (#441/#456) by marking rows whose record was soft-deleted but
--      whose wide row was never cascaded away.
DO $$
DECLARE
  t text;
BEGIN
  FOR t IN
    SELECT tablename
    FROM pg_tables
    WHERE schemaname = 'public'
      AND tablename LIKE 'er\_\_%'
  LOOP
    EXECUTE format('ALTER TABLE %I ADD COLUMN IF NOT EXISTS "deleted" bigint', t);
    EXECUTE format(
      'UPDATE %I w SET "deleted" = er."deleted" ' ||
      'FROM entity_records er ' ||
      'WHERE er.id = w."entity_record_id" AND er."deleted" IS NOT NULL',
      t
    );
  END LOOP;
END $$;
