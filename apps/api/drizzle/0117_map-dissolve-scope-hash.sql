-- #643: per-scope map dissolve. Adds the content-addressed scope key
-- (`scope_hash`) so a viewer is served coverage computed for exactly their
-- curated-view entitlement, plus `last_served_at` to drive the orphan-scope
-- retention reap, and re-keys the serve indexes to include `scope_hash`.
--
-- The dissolve cache is a derived materialization (rebuilt by the precompute
-- job), so existing org-wide rows — which carry no per-scope hash and would
-- never be served — are truncated rather than backfilled.
--
-- destructive-ok: derived dissolve cache, rebuilt by the precompute job (#643)
TRUNCATE TABLE "map_dissolve_geometries";--> statement-breakpoint
ALTER TABLE "map_dissolve_geometries" ADD COLUMN "scope_hash" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "map_dissolve_geometries" ADD COLUMN "last_served_at" bigint;--> statement-breakpoint
DROP INDEX IF EXISTS "map_dissolve_geometries_lookup_idx";--> statement-breakpoint
DROP INDEX IF EXISTS "map_dissolve_geometries_message_lookup_idx";--> statement-breakpoint
CREATE INDEX "map_dissolve_geometries_lookup_idx" ON "map_dissolve_geometries" USING btree ("portal_result_id","column_name","zoom_band","merged","scope_hash");--> statement-breakpoint
CREATE INDEX "map_dissolve_geometries_message_lookup_idx" ON "map_dissolve_geometries" USING btree ("message_id","block_index","column_name","zoom_band","merged","scope_hash");--> statement-breakpoint
CREATE INDEX "map_dissolve_geometries_last_served_idx" ON "map_dissolve_geometries" USING btree ("last_served_at");
