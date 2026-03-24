CREATE TABLE "entity_group_members" (
	"id" text PRIMARY KEY NOT NULL,
	"created" bigint NOT NULL,
	"created_by" text NOT NULL,
	"updated" bigint,
	"updated_by" text,
	"deleted" bigint,
	"deleted_by" text,
	"organization_id" text NOT NULL,
	"entity_group_id" text NOT NULL,
	"connector_entity_id" text NOT NULL,
	"link_field_mapping_id" text NOT NULL,
	"is_primary" boolean DEFAULT false NOT NULL,
	CONSTRAINT "entity_group_members_group_entity_unique" UNIQUE("entity_group_id","connector_entity_id")
);
--> statement-breakpoint
CREATE TABLE "entity_groups" (
	"id" text PRIMARY KEY NOT NULL,
	"created" bigint NOT NULL,
	"created_by" text NOT NULL,
	"updated" bigint,
	"updated_by" text,
	"deleted" bigint,
	"deleted_by" text,
	"organization_id" text NOT NULL,
	"name" text NOT NULL,
	"description" text
);
--> statement-breakpoint
ALTER TABLE "entity_group_members" ADD CONSTRAINT "entity_group_members_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "entity_group_members" ADD CONSTRAINT "entity_group_members_entity_group_id_entity_groups_id_fk" FOREIGN KEY ("entity_group_id") REFERENCES "public"."entity_groups"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "entity_group_members" ADD CONSTRAINT "entity_group_members_connector_entity_id_connector_entities_id_fk" FOREIGN KEY ("connector_entity_id") REFERENCES "public"."connector_entities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "entity_group_members" ADD CONSTRAINT "entity_group_members_link_field_mapping_id_field_mappings_id_fk" FOREIGN KEY ("link_field_mapping_id") REFERENCES "public"."field_mappings"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "entity_groups" ADD CONSTRAINT "entity_groups_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;