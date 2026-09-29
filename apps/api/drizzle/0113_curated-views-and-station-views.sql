CREATE TABLE "curated_view_field_mappings" (
	"id" text PRIMARY KEY NOT NULL,
	"created" bigint NOT NULL,
	"created_by" text NOT NULL,
	"updated" bigint,
	"updated_by" text,
	"deleted" bigint,
	"deleted_by" text,
	"organization_id" text NOT NULL,
	"curated_view_id" text NOT NULL,
	"field_mapping_id" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "curated_views" (
	"id" text PRIMARY KEY NOT NULL,
	"created" bigint NOT NULL,
	"created_by" text NOT NULL,
	"updated" bigint,
	"updated_by" text,
	"deleted" bigint,
	"deleted_by" text,
	"organization_id" text NOT NULL,
	"connector_entity_id" text NOT NULL,
	"key" text NOT NULL,
	"label" text NOT NULL,
	"description" text,
	"where_clause" text
);
--> statement-breakpoint
CREATE TABLE "station_views" (
	"id" text PRIMARY KEY NOT NULL,
	"created" bigint NOT NULL,
	"created_by" text NOT NULL,
	"updated" bigint,
	"updated_by" text,
	"deleted" bigint,
	"deleted_by" text,
	"organization_id" text NOT NULL,
	"station_id" text NOT NULL,
	"curated_view_id" text NOT NULL
);
--> statement-breakpoint
ALTER TABLE "curated_view_field_mappings" ADD CONSTRAINT "curated_view_field_mappings_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "curated_view_field_mappings" ADD CONSTRAINT "curated_view_field_mappings_curated_view_id_curated_views_id_fk" FOREIGN KEY ("curated_view_id") REFERENCES "public"."curated_views"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "curated_view_field_mappings" ADD CONSTRAINT "curated_view_field_mappings_field_mapping_id_field_mappings_id_fk" FOREIGN KEY ("field_mapping_id") REFERENCES "public"."field_mappings"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "curated_views" ADD CONSTRAINT "curated_views_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "curated_views" ADD CONSTRAINT "curated_views_connector_entity_id_connector_entities_id_fk" FOREIGN KEY ("connector_entity_id") REFERENCES "public"."connector_entities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "station_views" ADD CONSTRAINT "station_views_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "station_views" ADD CONSTRAINT "station_views_station_id_stations_id_fk" FOREIGN KEY ("station_id") REFERENCES "public"."stations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "station_views" ADD CONSTRAINT "station_views_curated_view_id_curated_views_id_fk" FOREIGN KEY ("curated_view_id") REFERENCES "public"."curated_views"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "curated_view_field_mappings_view_fm_unique" ON "curated_view_field_mappings" USING btree ("curated_view_id","field_mapping_id") WHERE deleted IS NULL;--> statement-breakpoint
CREATE INDEX "curated_view_field_mappings_view_idx" ON "curated_view_field_mappings" USING btree ("curated_view_id") WHERE deleted IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "curated_views_org_key_unique" ON "curated_views" USING btree ("organization_id","key") WHERE deleted IS NULL;--> statement-breakpoint
CREATE INDEX "curated_views_org_created_idx" ON "curated_views" USING btree ("organization_id","created","id") WHERE deleted IS NULL;--> statement-breakpoint
CREATE INDEX "curated_views_entity_idx" ON "curated_views" USING btree ("connector_entity_id") WHERE deleted IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "station_views_station_view_unique" ON "station_views" USING btree ("station_id","curated_view_id") WHERE deleted IS NULL;--> statement-breakpoint
CREATE INDEX "station_views_station_idx" ON "station_views" USING btree ("station_id") WHERE deleted IS NULL;--> statement-breakpoint
-- #599: cutover backfill. A station's data attachment moves from connectors
-- (`station_instances`) to curated views (`station_views`). For every entity of
-- a station's currently-attached connector instance, generate one default
-- (unrestricted) curated view — null `where_clause`, no projection rows (= all
-- columns) — and attach it to the station. NO permission grants are created
-- (default-deny; admins reach these via AdminAccess `*`, members via a later
-- share). Additive only: `station_instances` is untouched and still drives reads
-- until the slice-3 read cutover. Idempotent — the partial-unique `ON CONFLICT`
-- restates `WHERE deleted IS NULL` so a re-run is a safe no-op.
--
-- backfill:curated-views-default-views
INSERT INTO "curated_views" (
	"id", "created", "created_by", "updated", "updated_by", "deleted", "deleted_by",
	"organization_id", "connector_entity_id", "key", "label", "description", "where_clause"
)
SELECT
	gen_random_uuid()::text,
	(extract(epoch from now()) * 1000)::bigint,
	ce."created_by", NULL, NULL, NULL, NULL,
	ce."organization_id", ce."id", ce."key", ce."label", NULL, NULL
FROM "connector_entities" ce
WHERE ce."deleted" IS NULL
	AND EXISTS (
		SELECT 1 FROM "station_instances" si
		WHERE si."connector_instance_id" = ce."connector_instance_id"
			AND si."deleted" IS NULL
	)
ON CONFLICT ("organization_id", "key") WHERE deleted IS NULL DO NOTHING;--> statement-breakpoint
-- backfill:station-views-attachments
INSERT INTO "station_views" (
	"id", "created", "created_by", "updated", "updated_by", "deleted", "deleted_by",
	"organization_id", "station_id", "curated_view_id"
)
SELECT
	gen_random_uuid()::text,
	(extract(epoch from now()) * 1000)::bigint,
	ce."created_by", NULL, NULL, NULL, NULL,
	ce."organization_id", si."station_id", cv."id"
FROM "station_instances" si
JOIN "connector_entities" ce
	ON ce."connector_instance_id" = si."connector_instance_id"
	AND ce."deleted" IS NULL
JOIN "curated_views" cv
	ON cv."organization_id" = ce."organization_id"
	AND cv."key" = ce."key"
	AND cv."deleted" IS NULL
WHERE si."deleted" IS NULL
ON CONFLICT ("station_id", "curated_view_id") WHERE deleted IS NULL DO NOTHING;