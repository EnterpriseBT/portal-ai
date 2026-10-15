-- #802: repair the curated views earlier connector and entity deletes left
-- behind. Those deletes soft-deleted the entity and never touched its views,
-- which stayed listed, stayed attached to their stations, and answered 500 on
-- open. The delete cascade now removes them (CuratedViewDeleteService); this
-- applies the same cascade to the views already orphaned:
--
--   a live view whose connector entity is soft-deleted →
--     its curated_view resource grants and in_curated_view field grants are
--     hard-deleted, its projection rows and station attachments are
--     soft-deleted, then the view is.
--
-- Views over a live entity are untouched. View links to a deleted *mapping*
-- are deliberately left alone: they project nothing (the resolver intersects
-- with live columns), and removing a view's last link would widen it to every
-- column.
--
-- Data only (no DDL). Idempotent: once a view is soft-deleted it leaves the
-- orphan set, so every statement below matches nothing on a second run. The
-- view is soft-deleted last, so each statement still sees the full set.

DELETE FROM "permission_grants" g
USING "curated_views" v
JOIN "connector_entities" e ON e."id" = v."connector_entity_id"
WHERE v."deleted" IS NULL
  AND e."deleted" IS NOT NULL
  AND g."organization_id" = v."organization_id"
  AND g."resource_type" = 'curated_view'
  AND g."resource_id" = v."id";
--> statement-breakpoint
DELETE FROM "permission_grants" g
USING "curated_views" v
JOIN "connector_entities" e ON e."id" = v."connector_entity_id"
WHERE v."deleted" IS NULL
  AND e."deleted" IS NOT NULL
  AND g."organization_id" = v."organization_id"
  AND g."resource_type" = 'field_mapping'
  AND g."condition" = 'in_curated_view'
  AND g."condition_param" = v."id";
--> statement-breakpoint
UPDATE "curated_view_field_mappings" l
SET "deleted" = (extract(epoch from now()) * 1000)::bigint,
    "deleted_by" = 'system'
FROM "curated_views" v
JOIN "connector_entities" e ON e."id" = v."connector_entity_id"
WHERE l."curated_view_id" = v."id"
  AND l."deleted" IS NULL
  AND v."deleted" IS NULL
  AND e."deleted" IS NOT NULL;
--> statement-breakpoint
UPDATE "station_views" sv
SET "deleted" = (extract(epoch from now()) * 1000)::bigint,
    "deleted_by" = 'system'
FROM "curated_views" v
JOIN "connector_entities" e ON e."id" = v."connector_entity_id"
WHERE sv."curated_view_id" = v."id"
  AND sv."deleted" IS NULL
  AND v."deleted" IS NULL
  AND e."deleted" IS NOT NULL;
--> statement-breakpoint
UPDATE "curated_views" v
SET "deleted" = (extract(epoch from now()) * 1000)::bigint,
    "deleted_by" = 'system'
FROM "connector_entities" e
WHERE e."id" = v."connector_entity_id"
  AND v."deleted" IS NULL
  AND e."deleted" IS NOT NULL;
