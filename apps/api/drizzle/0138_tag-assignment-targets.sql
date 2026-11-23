ALTER TABLE "entity_tag_assignments" ALTER COLUMN "connector_entity_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "entity_tag_assignments" ADD COLUMN "station_id" text;--> statement-breakpoint
ALTER TABLE "entity_tag_assignments" ADD COLUMN "portal_result_id" text;--> statement-breakpoint
ALTER TABLE "entity_tag_assignments" ADD COLUMN "connector_instance_id" text;--> statement-breakpoint
ALTER TABLE "entity_tag_assignments" ADD COLUMN "curated_view_id" text;--> statement-breakpoint
ALTER TABLE "entity_tag_assignments" ADD CONSTRAINT "entity_tag_assignments_station_id_stations_id_fk" FOREIGN KEY ("station_id") REFERENCES "public"."stations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "entity_tag_assignments" ADD CONSTRAINT "entity_tag_assignments_portal_result_id_portal_results_id_fk" FOREIGN KEY ("portal_result_id") REFERENCES "public"."portal_results"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "entity_tag_assignments" ADD CONSTRAINT "entity_tag_assignments_connector_instance_id_connector_instances_id_fk" FOREIGN KEY ("connector_instance_id") REFERENCES "public"."connector_instances"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "entity_tag_assignments" ADD CONSTRAINT "entity_tag_assignments_curated_view_id_curated_views_id_fk" FOREIGN KEY ("curated_view_id") REFERENCES "public"."curated_views"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "entity_tag_assignments_station_tag_unique" ON "entity_tag_assignments" USING btree ("station_id","entity_tag_id") WHERE deleted IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "entity_tag_assignments_portal_result_tag_unique" ON "entity_tag_assignments" USING btree ("portal_result_id","entity_tag_id") WHERE deleted IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "entity_tag_assignments_connector_instance_tag_unique" ON "entity_tag_assignments" USING btree ("connector_instance_id","entity_tag_id") WHERE deleted IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "entity_tag_assignments_curated_view_tag_unique" ON "entity_tag_assignments" USING btree ("curated_view_id","entity_tag_id") WHERE deleted IS NULL;--> statement-breakpoint
CREATE INDEX "entity_tag_assignments_tag_idx" ON "entity_tag_assignments" USING btree ("entity_tag_id") WHERE deleted IS NULL;--> statement-breakpoint
ALTER TABLE "entity_tag_assignments" ADD CONSTRAINT "entity_tag_assignments_one_target" CHECK (num_nonnulls("entity_tag_assignments"."connector_entity_id", "entity_tag_assignments"."station_id", "entity_tag_assignments"."portal_result_id", "entity_tag_assignments"."connector_instance_id", "entity_tag_assignments"."curated_view_id") = 1);