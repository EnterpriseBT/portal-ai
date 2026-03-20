ALTER TABLE "column_definitions" DROP CONSTRAINT "column_definitions_ref_column_definition_id_column_definitions_id_fk";
--> statement-breakpoint
ALTER TABLE "field_mappings" ADD COLUMN "ref_column_definition_id" text;--> statement-breakpoint
ALTER TABLE "field_mappings" ADD COLUMN "ref_entity_key" text;--> statement-breakpoint
ALTER TABLE "field_mappings" ADD CONSTRAINT "field_mappings_ref_column_definition_id_column_definitions_id_fk" FOREIGN KEY ("ref_column_definition_id") REFERENCES "public"."column_definitions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "column_definitions" DROP COLUMN "ref_column_definition_id";--> statement-breakpoint
ALTER TABLE "column_definitions" DROP COLUMN "ref_entity_key";