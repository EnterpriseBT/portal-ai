-- Step 1: Add new columns (with defaults for existing rows)
ALTER TABLE "field_mappings" ADD COLUMN "normalized_key" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "field_mappings" ADD COLUMN "required" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "field_mappings" ADD COLUMN "default_value" text;--> statement-breakpoint
ALTER TABLE "field_mappings" ADD COLUMN "format" text;--> statement-breakpoint
ALTER TABLE "field_mappings" ADD COLUMN "enum_values" jsonb;--> statement-breakpoint

ALTER TABLE "entity_records" ADD COLUMN "validation_errors" jsonb;--> statement-breakpoint
ALTER TABLE "entity_records" ADD COLUMN "is_valid" boolean DEFAULT true NOT NULL;--> statement-breakpoint

ALTER TABLE "column_definitions" ADD COLUMN "validation_pattern" text;--> statement-breakpoint
ALTER TABLE "column_definitions" ADD COLUMN "validation_message" text;--> statement-breakpoint
ALTER TABLE "column_definitions" ADD COLUMN "canonical_format" text;--> statement-breakpoint

-- Step 2: Backfill field_mappings from linked column_definitions
UPDATE "field_mappings" fm
SET "normalized_key" = cd."key",
    "required" = cd."required",
    "default_value" = cd."default_value",
    "format" = cd."format",
    "enum_values" = cd."enum_values"
FROM "column_definitions" cd
WHERE fm."column_definition_id" = cd."id"
  AND fm."deleted" IS NULL;--> statement-breakpoint

-- Step 3: Migrate currency rows to number
UPDATE "column_definitions"
SET "type" = 'number', "canonical_format" = '$#,##0.00'
WHERE "type" = 'currency' AND "deleted" IS NULL;--> statement-breakpoint

-- Step 4: Drop removed columns from column_definitions
ALTER TABLE "column_definitions" DROP COLUMN IF EXISTS "required";--> statement-breakpoint
ALTER TABLE "column_definitions" DROP COLUMN IF EXISTS "default_value";--> statement-breakpoint
ALTER TABLE "column_definitions" DROP COLUMN IF EXISTS "format";--> statement-breakpoint
ALTER TABLE "column_definitions" DROP COLUMN IF EXISTS "enum_values";--> statement-breakpoint

-- Step 5: Remove 'currency' from pgEnum (rename-create-alter-drop)
ALTER TYPE "column_data_type" RENAME TO "column_data_type_old";--> statement-breakpoint
CREATE TYPE "column_data_type" AS ENUM('string', 'number', 'boolean', 'date', 'datetime', 'enum', 'json', 'array', 'reference', 'reference-array');--> statement-breakpoint
ALTER TABLE "column_definitions" ALTER COLUMN "type" TYPE "column_data_type" USING "type"::text::"column_data_type";--> statement-breakpoint
DROP TYPE "column_data_type_old";--> statement-breakpoint

-- Step 6: Add new indexes
CREATE UNIQUE INDEX "field_mappings_entity_normalized_key_unique" ON "field_mappings" USING btree ("connector_entity_id","normalized_key") WHERE deleted IS NULL;--> statement-breakpoint
CREATE INDEX "entity_records_entity_is_valid_idx" ON "entity_records" USING btree ("connector_entity_id","is_valid");
