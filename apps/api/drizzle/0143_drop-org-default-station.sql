-- #1118: the contract half of #1114's expand/contract. Nothing has read or
-- written this column since #1114 (PR #1117), which shipped in an earlier
-- release, so no running task selects it when this applies.
-- IF EXISTS: a dev database synced with `db:push` after #1114 already lost it.
-- destructive-ok: column unread since #1114 (PR #1117)
ALTER TABLE "organizations" DROP COLUMN IF EXISTS "default_station_id";
