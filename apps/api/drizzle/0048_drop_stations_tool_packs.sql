-- Drop `stations.tool_packs` jsonb in favor of the `station_toolpacks`
-- join table.
--
-- Phase 1 of the toolpack work moves "what packs does a station have"
-- out of a jsonb array on the row and into a first-class join table
-- with one row per pack. After this migration the answer is
-- materialized via a SELECT against `station_toolpacks` rather than
-- read off a jsonb column.
--
-- Steps:
--   1. Copy each live station's `tool_packs` array into one row per slug
--      in `station_toolpacks` (`builtin_slug` set, `organization_toolpack_id`
--      null). The new row's `created`/`createdBy` mirror the station's.
--   2. Drop the `tool_packs` column.
--
-- We use `gen_random_uuid()` (built into Postgres 13+ via the pgcrypto
-- extension or core in 13+) cast to text — matches the project's
-- text-columned UUID-v4 primary key convention.

INSERT INTO "station_toolpacks"
  ("id", "created", "created_by",
   "updated", "updated_by", "deleted", "deleted_by",
   "station_id", "builtin_slug", "organization_toolpack_id")
SELECT
  gen_random_uuid()::text,
  s."created",
  s."created_by",
  NULL, NULL, NULL, NULL,
  s."id",
  pack.value::text,
  NULL
FROM "stations" s
CROSS JOIN LATERAL jsonb_array_elements_text(s."tool_packs") AS pack(value)
WHERE s."deleted" IS NULL
  AND s."tool_packs" IS NOT NULL;

ALTER TABLE "stations" DROP COLUMN IF EXISTS "tool_packs";
