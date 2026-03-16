CREATE TYPE "public"."column_data_type" AS ENUM('string', 'number', 'boolean', 'date', 'datetime', 'enum', 'json', 'array', 'reference');--> statement-breakpoint
CREATE TABLE "column_definitions" (
	"id" text PRIMARY KEY NOT NULL,
	"created" bigint NOT NULL,
	"created_by" text NOT NULL,
	"updated" bigint,
	"updated_by" text,
	"deleted" bigint,
	"deleted_by" text,
	"organization_id" text NOT NULL,
	"key" text NOT NULL,
	"label" text NOT NULL,
	"type" "column_data_type" NOT NULL,
	"required" boolean NOT NULL,
	"default_value" text,
	"format" text,
	"enum_values" jsonb,
	"description" text,
	"ref_column_definition_id" text,
	"ref_entity_key" text,
	CONSTRAINT "column_definitions_org_key_unique" UNIQUE("organization_id","key")
);
--> statement-breakpoint
CREATE TABLE "connector_entities" (
	"id" text PRIMARY KEY NOT NULL,
	"created" bigint NOT NULL,
	"created_by" text NOT NULL,
	"updated" bigint,
	"updated_by" text,
	"deleted" bigint,
	"deleted_by" text,
	"connector_instance_id" text NOT NULL,
	"key" text NOT NULL,
	"label" text NOT NULL,
	CONSTRAINT "connector_entities_instance_key_unique" UNIQUE("connector_instance_id","key")
);
--> statement-breakpoint
CREATE TABLE "field_mappings" (
	"id" text PRIMARY KEY NOT NULL,
	"created" bigint NOT NULL,
	"created_by" text NOT NULL,
	"updated" bigint,
	"updated_by" text,
	"deleted" bigint,
	"deleted_by" text,
	"connector_entity_id" text NOT NULL,
	"column_definition_id" text NOT NULL,
	"source_field" text NOT NULL,
	"is_primary_key" boolean NOT NULL,
	CONSTRAINT "field_mappings_entity_column_unique" UNIQUE("connector_entity_id","column_definition_id")
);
--> statement-breakpoint
ALTER TABLE "column_definitions" ADD CONSTRAINT "column_definitions_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "connector_entities" ADD CONSTRAINT "connector_entities_connector_instance_id_connector_instances_id_fk" FOREIGN KEY ("connector_instance_id") REFERENCES "public"."connector_instances"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "field_mappings" ADD CONSTRAINT "field_mappings_connector_entity_id_connector_entities_id_fk" FOREIGN KEY ("connector_entity_id") REFERENCES "public"."connector_entities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "field_mappings" ADD CONSTRAINT "field_mappings_column_definition_id_column_definitions_id_fk" FOREIGN KEY ("column_definition_id") REFERENCES "public"."column_definitions"("id") ON DELETE no action ON UPDATE no action;