-- Rename the `query` capability flag to `read` on all existing connector
-- definitions and connector instances so that the definition ceiling and the
-- per-instance override agree on a shared shape: { sync?, read?, write?, push? }.
--
-- The `push` flag is newly introduced; rows without it are treated as push=false
-- at read time, so no default backfill is required here.
--
-- `capability_flags` and `enabled_capability_flags` are both jsonb columns, so
-- this is a data-only migration; the SQL-level column shape is unchanged.
UPDATE "connector_definitions"
SET "capability_flags" = ("capability_flags" - 'query') || jsonb_build_object('read', "capability_flags"->'query'),
    "updated" = (EXTRACT(EPOCH FROM NOW()) * 1000)::bigint
WHERE "capability_flags" ? 'query';

UPDATE "connector_instances"
SET "enabled_capability_flags" = ("enabled_capability_flags" - 'query') || jsonb_build_object('read', "enabled_capability_flags"->'query'),
    "updated" = (EXTRACT(EPOCH FROM NOW()) * 1000)::bigint
WHERE "enabled_capability_flags" IS NOT NULL
  AND "enabled_capability_flags" ? 'query';
