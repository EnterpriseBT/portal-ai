-- Drop the legacy single-tool plumbing.
--
-- `organization_tools` and `station_tools` modeled "one custom webhook
-- tool per row" — the per-row registration concept that never had a
-- UI and therefore never accumulated production data. Phase 1 of the
-- toolpack work replaces them with the toolpack-level abstraction:
-- `organization_toolpacks` (added in phase 2) plus the new
-- `station_toolpacks` join (added in 0047).
--
-- station_tools FK references organization_tools, so it goes first.

DROP TABLE IF EXISTS "station_tools";
DROP TABLE IF EXISTS "organization_tools";
