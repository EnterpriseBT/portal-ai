-- #1072: favorites, one user's star on one station, pin, view or connector.
-- Schema-only; nothing to backfill. Rows are hard-deleted, so the unique
-- indexes are not partial.
CREATE TABLE "favorites" (
	"id" text PRIMARY KEY NOT NULL,
	"created" bigint NOT NULL,
	"created_by" text NOT NULL,
	"updated" bigint,
	"updated_by" text,
	"deleted" bigint,
	"deleted_by" text,
	"organization_id" text NOT NULL,
	"user_id" text NOT NULL,
	"station_id" text,
	"portal_result_id" text,
	"curated_view_id" text,
	"connector_instance_id" text,
	CONSTRAINT "favorites_one_target" CHECK (num_nonnulls("favorites"."station_id", "favorites"."portal_result_id", "favorites"."curated_view_id", "favorites"."connector_instance_id") = 1)
);
--> statement-breakpoint
ALTER TABLE "favorites" ADD CONSTRAINT "favorites_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "favorites" ADD CONSTRAINT "favorites_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "favorites" ADD CONSTRAINT "favorites_station_id_stations_id_fk" FOREIGN KEY ("station_id") REFERENCES "public"."stations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "favorites" ADD CONSTRAINT "favorites_portal_result_id_portal_results_id_fk" FOREIGN KEY ("portal_result_id") REFERENCES "public"."portal_results"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "favorites" ADD CONSTRAINT "favorites_curated_view_id_curated_views_id_fk" FOREIGN KEY ("curated_view_id") REFERENCES "public"."curated_views"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "favorites" ADD CONSTRAINT "favorites_connector_instance_id_connector_instances_id_fk" FOREIGN KEY ("connector_instance_id") REFERENCES "public"."connector_instances"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "favorites_station_user_unique" ON "favorites" USING btree ("station_id","user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "favorites_portal_result_user_unique" ON "favorites" USING btree ("portal_result_id","user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "favorites_curated_view_user_unique" ON "favorites" USING btree ("curated_view_id","user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "favorites_connector_instance_user_unique" ON "favorites" USING btree ("connector_instance_id","user_id");--> statement-breakpoint
CREATE INDEX "favorites_org_user_idx" ON "favorites" USING btree ("organization_id","user_id");