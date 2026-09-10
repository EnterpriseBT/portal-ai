ALTER TABLE "map_dissolve_geometries" ALTER COLUMN "portal_result_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "map_dissolve_geometries" ADD COLUMN "message_id" text;--> statement-breakpoint
ALTER TABLE "map_dissolve_geometries" ADD COLUMN "block_index" integer;--> statement-breakpoint
ALTER TABLE "map_dissolve_geometries" ADD CONSTRAINT "map_dissolve_geometries_message_id_portal_messages_id_fk" FOREIGN KEY ("message_id") REFERENCES "public"."portal_messages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "map_dissolve_geometries_message_lookup_idx" ON "map_dissolve_geometries" USING btree ("message_id","block_index","column_name","zoom_band","merged");--> statement-breakpoint
-- #542: exactly-one-owner. A row is owned by a pin (portal_result_id) OR a
-- message block (message_id + block_index), never both/neither. Hand-added —
-- drizzle-kit does not model CHECK constraints. Existing pin rows satisfy it.
ALTER TABLE "map_dissolve_geometries" ADD CONSTRAINT "map_dissolve_geometries_one_owner" CHECK (
  ("portal_result_id" IS NOT NULL AND "message_id" IS NULL AND "block_index" IS NULL)
  OR ("portal_result_id" IS NULL AND "message_id" IS NOT NULL AND "block_index" IS NOT NULL)
);
