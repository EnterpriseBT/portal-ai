CREATE TABLE "entity_tag_assignments" (
	"id" text PRIMARY KEY NOT NULL,
	"created" bigint NOT NULL,
	"created_by" text NOT NULL,
	"updated" bigint,
	"updated_by" text,
	"deleted" bigint,
	"deleted_by" text,
	"organization_id" text NOT NULL,
	"connector_entity_id" text NOT NULL,
	"entity_tag_id" text NOT NULL,
	CONSTRAINT "entity_tag_assignments_entity_tag_unique" UNIQUE("connector_entity_id","entity_tag_id")
);
--> statement-breakpoint
CREATE TABLE "entity_tags" (
	"id" text PRIMARY KEY NOT NULL,
	"created" bigint NOT NULL,
	"created_by" text NOT NULL,
	"updated" bigint,
	"updated_by" text,
	"deleted" bigint,
	"deleted_by" text,
	"organization_id" text NOT NULL,
	"name" text NOT NULL,
	"color" text,
	"description" text
);
--> statement-breakpoint
ALTER TABLE "entity_tag_assignments" ADD CONSTRAINT "entity_tag_assignments_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "entity_tag_assignments" ADD CONSTRAINT "entity_tag_assignments_connector_entity_id_connector_entities_id_fk" FOREIGN KEY ("connector_entity_id") REFERENCES "public"."connector_entities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "entity_tag_assignments" ADD CONSTRAINT "entity_tag_assignments_entity_tag_id_entity_tags_id_fk" FOREIGN KEY ("entity_tag_id") REFERENCES "public"."entity_tags"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "entity_tags" ADD CONSTRAINT "entity_tags_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;