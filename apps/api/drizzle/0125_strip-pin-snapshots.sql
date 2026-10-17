-- #640: a data pin is a recipe — it stores its query and how to draw it, never
-- rows. Pins saved before #640 copied their whole source block, so besides
-- `rows` they may hold `samplePeek`, counts and handle envelope fields. Keep
-- only each type's recipe keys (an allowlist, so nothing data-bearing is left
-- behind), soft-deleted rows included: a tombstoned pin must not retain data.
UPDATE "portal_results" SET "content" = COALESCE((
  SELECT jsonb_object_agg(e.key, e.value)
  FROM jsonb_each("portal_results"."content") AS e
  WHERE e.key = ANY (CASE "portal_results"."type"
    WHEN 'data-table' THEN ARRAY['columns', 'pipeline']
    WHEN 'd3' THEN ARRAY['program', 'title', 'params', 'pipeline']
    WHEN 'geo' THEN ARRAY['spec', 'title', 'pipeline', 'program', 'tiled']
  END)
), '{}'::jsonb)
WHERE "type" IN ('data-table', 'd3', 'geo') AND jsonb_typeof("content") = 'object';--> statement-breakpoint
ALTER TABLE "portal_results" DROP COLUMN "snapshot_updated_at"; -- destructive-ok: a pin stores no snapshot, so it has no snapshot clock (#640)
