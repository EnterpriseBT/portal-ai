-- #414: backfill the three geospatial system column definitions (#316) onto
-- every organization that already existed when 0077 shipped.
--
-- 0077 added the `geometry` enum value and the `geo_role` column but no rows.
-- `seedSystemColumnDefinitions` only runs at org provisioning, so orgs created
-- before #316 kept their pre-#316 catalog of 26 definitions and had nothing to
-- bind an imported geometry column to.
--
-- Idempotent by design: the conflict target repeats the partial predicate of
-- `column_definitions_org_key_unique` (a partial index is only matched by an
-- ON CONFLICT that restates its WHERE), so this is a verified no-op on any org
-- that already holds these keys — which is every org on prod and local.
--
-- Adding an entry to SYSTEM_COLUMN_DEFINITIONS requires a migration like this
-- one; see the note on that array in apps/api/src/services/seed.service.ts.
INSERT INTO "column_definitions" (
	"id", "created", "created_by", "organization_id",
	"key", "label", "type", "description",
	"validation_pattern", "validation_message", "canonical_format",
	"system", "geo_role"
)
SELECT
	gen_random_uuid()::text,
	(extract(epoch from now()) * 1000)::bigint,
	'SYSTEM',
	o."id",
	d."key",
	d."label",
	d."type"::"public"."column_data_type",
	d."description",
	NULL,
	NULL,
	NULL,
	true,
	d."geo_role"::"public"."geo_role"
FROM "organizations" o
CROSS JOIN (
	VALUES
		('geometry', 'Geometry', 'geometry', 'PostGIS geometry (point, line, or polygon) in EPSG:4326', NULL),
		('latitude', 'Latitude', 'number', 'Latitude in decimal degrees (WGS 84)', 'lat'),
		('longitude', 'Longitude', 'number', 'Longitude in decimal degrees (WGS 84)', 'lng')
) AS d("key", "label", "type", "description", "geo_role")
WHERE o."deleted" IS NULL
ON CONFLICT ("organization_id", "key") WHERE "deleted" IS NULL DO NOTHING;
