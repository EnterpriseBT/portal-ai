-- Historical migration: added `gsheets_sync` to the `job_type` enum
-- when the manual-sync feature first landed (Phase D Slice 5). Was
-- later superseded by `connector_sync` (added in 0045) once the sync
-- service was generalized away from gsheets-specific job types. This
-- value is left in the enum because Postgres makes `DROP VALUE`
-- expensive (full enum recreation) and it's harmless: no application
-- code emits `gsheets_sync` anymore.

ALTER TYPE "job_type" ADD VALUE IF NOT EXISTS 'gsheets_sync';
