-- Wide-table storage — Phase 1 foundation.
--
-- This migration creates the `wide_table_columns` metadata catalog.
-- The reconciler (apps/api/src/services/wide-table-reconciler.service.ts)
-- is the only writer; one row per (connector_entity, field_mapping)
-- linkage to its corresponding wide-table column.
--
-- The dynamic per-entity wide tables themselves (`er__<connector_entity_id>`)
-- are NOT created here — they are created at runtime by the reconciler
-- on connector-entity create or boot drift check. Modelling per-entity
-- tables in static Drizzle is a category error; the set is dynamic.
--
-- `retired_at` is set when the source field-mapping is soft-deleted.
-- The Postgres column itself stays on disk; phase 5 adds a maintenance
-- job that drops retired columns past a retention window.

CREATE TABLE IF NOT EXISTS "wide_table_columns" (
  "id" text PRIMARY KEY NOT NULL,
  "created" bigint NOT NULL,
  "created_by" text NOT NULL,
  "updated" bigint,
  "updated_by" text,
  "deleted" bigint,
  "deleted_by" text,
  "organization_id" text NOT NULL,
  "connector_entity_id" text NOT NULL,
  "field_mapping_id" text NOT NULL,
  "column_definition_id" text NOT NULL,
  "column_name" text NOT NULL,
  "pg_type" text NOT NULL,
  "retired_at" bigint
);

DO $$ BEGIN
  ALTER TABLE "wide_table_columns"
    ADD CONSTRAINT "wide_table_columns_organization_id_organizations_id_fk"
    FOREIGN KEY ("organization_id") REFERENCES "organizations"("id");
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "wide_table_columns"
    ADD CONSTRAINT "wide_table_columns_connector_entity_id_connector_entities_id_fk"
    FOREIGN KEY ("connector_entity_id") REFERENCES "connector_entities"("id");
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "wide_table_columns"
    ADD CONSTRAINT "wide_table_columns_field_mapping_id_field_mappings_id_fk"
    FOREIGN KEY ("field_mapping_id") REFERENCES "field_mappings"("id");
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "wide_table_columns"
    ADD CONSTRAINT "wide_table_columns_column_definition_id_column_definitions_id_fk"
    FOREIGN KEY ("column_definition_id") REFERENCES "column_definitions"("id");
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS "wide_table_columns_entity_column_unique"
  ON "wide_table_columns" ("connector_entity_id", "column_name")
  WHERE "deleted" IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS "wide_table_columns_entity_field_mapping_unique"
  ON "wide_table_columns" ("connector_entity_id", "field_mapping_id")
  WHERE "deleted" IS NULL;

CREATE INDEX IF NOT EXISTS "wide_table_columns_entity_idx"
  ON "wide_table_columns" ("connector_entity_id");
