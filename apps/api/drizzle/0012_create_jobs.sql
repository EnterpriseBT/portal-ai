DO $$ BEGIN
  CREATE TYPE "job_status" AS ENUM ('pending', 'active', 'completed', 'failed', 'stalled', 'cancelled');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  CREATE TYPE "job_type" AS ENUM ('file_upload');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

CREATE TABLE IF NOT EXISTS "jobs" (
	"id" text PRIMARY KEY NOT NULL,
	"created" bigint NOT NULL,
	"created_by" text NOT NULL,
	"updated" bigint,
	"updated_by" text,
	"deleted" bigint,
	"deleted_by" text,
	"organization_id" text NOT NULL,
	"type" "job_type" NOT NULL,
	"status" "job_status" DEFAULT 'pending' NOT NULL,
	"progress" integer DEFAULT 0 NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"result" jsonb,
	"error" text,
	"started_at" bigint,
	"completed_at" bigint,
	"bull_job_id" text,
	"attempts" integer DEFAULT 0 NOT NULL,
	"max_attempts" integer DEFAULT 3 NOT NULL
);
