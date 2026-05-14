-- Wide-table storage — Phase 2 Slice 6: drop `entity_records.normalized_data`.
--
-- The wide table set (`er__<connector_entity_id>`) is now the source of
-- truth for normalized data. The transactional `entity_records` table
-- keeps its identity, metadata, and `data` JSONB (the raw connector
-- payload), but the redundant `normalized_data` column drops along with
-- its GIN index.
--
-- The migration TRUNCATEs `entity_records` so the `NOT NULL`
-- `normalized_data` column can be dropped without violating constraints
-- and so every connected store (`er__<id>`, entity_groups, tags, etc.)
-- gets a clean slate. The post-deploy `wideTableResyncService.
-- resyncAllConnectorInstances` re-runs every adapter's sync to repopulate
-- both stores from source.
--
-- No production data exists yet (memory `project_no_production_data_yet`,
-- dated 2026-05-08). The truncate is intentional.

DROP INDEX IF EXISTS "entity_records_normalized_data_gin";

-- Cascade clears `er__<id>` rows via the
-- `entity_record_id REFERENCES entity_records(id) ON DELETE CASCADE`
-- FK on every wide table.
TRUNCATE TABLE "entity_records" CASCADE;

ALTER TABLE "entity_records" DROP COLUMN "normalized_data";
