-- Create the `organization_toolpacks` table — the FK target for
-- `station_toolpacks.organization_toolpack_id` (column already exists
-- from migration 0047, nullable, unconstrained until now).
--
-- Each row is a custom toolpack registered by an organization. The
-- cached `tools` and `metadata` columns are populated by the
-- registration service at registration and on explicit refresh.
-- `auth_headers` is plain jsonb redacted on every read endpoint.
--
-- The unique partial index on (organization_id, name) WHERE deleted
-- IS NULL allows the same name to be re-registered after a soft
-- delete, matching the pattern used elsewhere in the schema.

CREATE TABLE IF NOT EXISTS "organization_toolpacks" (
  "id" text PRIMARY KEY NOT NULL,
  "created" bigint NOT NULL,
  "created_by" text NOT NULL,
  "updated" bigint,
  "updated_by" text,
  "deleted" bigint,
  "deleted_by" text,
  "organization_id" text NOT NULL,
  "name" text NOT NULL,
  "description" text,
  "endpoints" jsonb NOT NULL,
  "auth_headers" jsonb,
  "tools" jsonb NOT NULL,
  "metadata" jsonb,
  "schema_fetched_at" bigint NOT NULL,
  "metadata_fetched_at" bigint
);

DO $$ BEGIN
  ALTER TABLE "organization_toolpacks"
    ADD CONSTRAINT "organization_toolpacks_organization_id_organizations_id_fk"
    FOREIGN KEY ("organization_id") REFERENCES "organizations"("id");
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS "organization_toolpacks_org_name_unique"
  ON "organization_toolpacks" ("organization_id", "name")
  WHERE "deleted" IS NULL;

DO $$ BEGIN
  ALTER TABLE "station_toolpacks"
    ADD CONSTRAINT "station_toolpacks_organization_toolpack_id_fk"
    FOREIGN KEY ("organization_toolpack_id")
    REFERENCES "organization_toolpacks"("id");
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
