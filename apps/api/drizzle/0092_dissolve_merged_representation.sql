DROP INDEX "map_dissolve_geometries_lookup_idx";--> statement-breakpoint
ALTER TABLE "map_dissolve_geometries" ADD COLUMN "merged" boolean DEFAULT false NOT NULL;--> statement-breakpoint
CREATE INDEX "map_dissolve_geometries_lookup_idx" ON "map_dissolve_geometries" USING btree ("portal_result_id","column_name","zoom_band","merged");