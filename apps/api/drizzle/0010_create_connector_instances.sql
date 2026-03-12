DO $$ BEGIN
  CREATE TYPE "connector_instance_status" AS ENUM ('active', 'inactive', 'error', 'pending');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

CREATE TABLE IF NOT EXISTS "connector_instances" (
	"id" text PRIMARY KEY NOT NULL,
	"created" bigint NOT NULL,
	"created_by" text NOT NULL,
	"updated" bigint,
	"updated_by" text,
	"deleted" bigint,
	"deleted_by" text,
	"connector_definition_id" text NOT NULL,
	"organization_id" text NOT NULL,
	"name" text NOT NULL,
	"status" "connector_instance_status" NOT NULL,
	"config" jsonb,
	"credentials" jsonb,
	"last_sync_at" bigint,
	"last_error_message" text
);
