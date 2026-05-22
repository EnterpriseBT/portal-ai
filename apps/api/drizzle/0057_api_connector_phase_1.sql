-- API connector — Phase 1 foundation.
--
-- Creates the `api_endpoint_configs` table — one row per `connector_entity`
-- belonging to a `rest-api` connector instance. Holds the per-entity HTTP
-- request shape: path, method (GET/POST), header / queryParam templates,
-- pagination strategy, recordsPath, idField.
--
-- Phase 1 hard-codes `pagination = 'none'` via the CHECK constraint;
-- phase 3 widens the allowed values to ('none', 'pageOffset', 'cursor',
-- 'linkHeader') and starts populating `pagination_config` + `body_template`.
--
-- See `docs/API_CONNECTOR_PHASE_1.spec.md` for the full contract.

CREATE TABLE IF NOT EXISTS "api_endpoint_configs" (
  "id" text PRIMARY KEY NOT NULL,
  "created" bigint NOT NULL,
  "created_by" text NOT NULL,
  "updated" bigint,
  "updated_by" text,
  "deleted" bigint,
  "deleted_by" text,
  "organization_id" text NOT NULL,
  "connector_entity_id" text NOT NULL,
  "path" text NOT NULL,
  "method" text NOT NULL,
  "headers" jsonb,
  "query_params" jsonb,
  "body_template" text,
  "pagination" text NOT NULL,
  "pagination_config" jsonb,
  "records_path" text NOT NULL DEFAULT '',
  "id_field" text,
  CONSTRAINT "api_endpoint_configs_method_check"
    CHECK ("method" IN ('GET', 'POST')),
  CONSTRAINT "api_endpoint_configs_pagination_phase1_check"
    CHECK ("pagination" = 'none')
);

DO $$ BEGIN
  ALTER TABLE "api_endpoint_configs"
    ADD CONSTRAINT "api_endpoint_configs_organization_id_organizations_id_fk"
    FOREIGN KEY ("organization_id") REFERENCES "organizations"("id");
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "api_endpoint_configs"
    ADD CONSTRAINT "api_endpoint_configs_connector_entity_id_connector_entities_id_fk"
    FOREIGN KEY ("connector_entity_id") REFERENCES "connector_entities"("id");
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS "api_endpoint_configs_entity_unique"
  ON "api_endpoint_configs" ("connector_entity_id")
  WHERE "deleted" IS NULL;
