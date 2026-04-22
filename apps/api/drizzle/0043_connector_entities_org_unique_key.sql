-- C2 — Entity key unique per organization
-- Spec: docs/REGION_CONFIG.c2_org_unique_entity_key.spec.md
--
-- Drops the old `(connector_instance_id, key)` partial unique index on
-- `connector_entities` and replaces it with `(organization_id, key)` —
-- a lookup-space guarantee so that any `FieldMapping.refEntityKey`
-- resolves to exactly one entity org-wide. Partial on
-- `deleted IS NULL` so a soft-deleted key frees up for reuse.
--
-- Rollback (one-way migration; do not plan to run):
--   DROP INDEX IF EXISTS "connector_entities_org_key_unique";
--   CREATE UNIQUE INDEX "connector_entities_instance_key_unique"
--     ON "connector_entities" USING btree ("connector_instance_id","key")
--     WHERE deleted IS NULL;

DROP INDEX IF EXISTS "connector_entities_instance_key_unique";--> statement-breakpoint
CREATE UNIQUE INDEX "connector_entities_org_key_unique" ON "connector_entities" USING btree ("organization_id","key") WHERE deleted IS NULL;
