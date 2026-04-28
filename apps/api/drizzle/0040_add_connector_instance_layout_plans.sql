CREATE TABLE "connector_instance_layout_plans" (
	"id" text PRIMARY KEY NOT NULL,
	"created" bigint NOT NULL,
	"created_by" text NOT NULL,
	"updated" bigint,
	"updated_by" text,
	"deleted" bigint,
	"deleted_by" text,
	"connector_instance_id" text NOT NULL,
	"plan_version" text NOT NULL,
	"revision_tag" text,
	"plan" jsonb NOT NULL,
	"interpretation_trace" jsonb,
	"superseded_by" text
);
--> statement-breakpoint
ALTER TABLE "connector_instance_layout_plans" ADD CONSTRAINT "connector_instance_layout_plans_connector_instance_id_connector_instances_id_fk" FOREIGN KEY ("connector_instance_id") REFERENCES "public"."connector_instances"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "cilp_instance_current_idx" ON "connector_instance_layout_plans" ("connector_instance_id", "superseded_by");
