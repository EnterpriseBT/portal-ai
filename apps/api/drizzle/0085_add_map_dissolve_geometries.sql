CREATE TABLE "map_dissolve_geometries" (
	"id" text PRIMARY KEY NOT NULL,
	"created" bigint NOT NULL,
	"created_by" text NOT NULL,
	"updated" bigint,
	"updated_by" text,
	"deleted" bigint,
	"deleted_by" text,
	"organization_id" text NOT NULL,
	"portal_result_id" text NOT NULL,
	"column_name" text NOT NULL,
	"value" text NOT NULL,
	"zoom_band" integer NOT NULL,
	"feature_count" integer NOT NULL
);
--> statement-breakpoint
ALTER TABLE "map_dissolve_geometries" ADD CONSTRAINT "map_dissolve_geometries_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "map_dissolve_geometries" ADD CONSTRAINT "map_dissolve_geometries_portal_result_id_portal_results_id_fk" FOREIGN KEY ("portal_result_id") REFERENCES "public"."portal_results"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "map_dissolve_geometries_key_unique" ON "map_dissolve_geometries" USING btree ("portal_result_id","column_name","value","zoom_band") WHERE deleted IS NULL;--> statement-breakpoint
CREATE INDEX "map_dissolve_geometries_pin_idx" ON "map_dissolve_geometries" USING btree ("portal_result_id");--> statement-breakpoint
-- #472: the dissolved geometry. PostGIS-typed, so added by hand (Drizzle has no
-- geometry type) — mirrors the wide-table geometry column. Stored as WGS84
-- MultiPolygon; the tile serve path clips it with ST_AsMVTGeom.
ALTER TABLE "map_dissolve_geometries" ADD COLUMN "geom" geometry(MultiPolygon, 4326);--> statement-breakpoint
CREATE INDEX "map_dissolve_geometries_geom_gist" ON "map_dissolve_geometries" USING GIST ("geom");