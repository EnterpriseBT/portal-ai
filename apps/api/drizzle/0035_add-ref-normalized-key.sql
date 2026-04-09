ALTER TABLE "field_mappings" ADD COLUMN "ref_normalized_key" text;--> statement-breakpoint
ALTER TABLE "field_mappings" DROP CONSTRAINT IF EXISTS "field_mappings_ref_column_definition_id_column_definitions_id_fk";--> statement-breakpoint
ALTER TABLE "field_mappings" DROP CONSTRAINT IF EXISTS "field_mappings_ref_bidirectional_field_mapping_id_field_mappings_id_fk";--> statement-breakpoint
DROP INDEX IF EXISTS "field_mappings_entity_column_unique";--> statement-breakpoint
ALTER TABLE "field_mappings" DROP COLUMN IF EXISTS "ref_column_definition_id";--> statement-breakpoint
ALTER TABLE "field_mappings" DROP COLUMN IF EXISTS "ref_bidirectional_field_mapping_id";
