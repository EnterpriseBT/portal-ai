ALTER TABLE "jobs" ALTER COLUMN "type" SET DATA TYPE text;--> statement-breakpoint
-- #131 (taxonomy F): the bulk_aggregate tool/processor/JobType are removed —
-- sql_query@job (#130 E1) rehomes the 120s off-thread aggregate scan. Drop any
-- orphaned bulk_aggregate job rows (terminal-only; nothing enqueues this type
-- anymore) so the recast to the new enum below cannot fail on a stale value.
DELETE FROM "jobs" WHERE "type" = 'bulk_aggregate';--> statement-breakpoint
DROP TYPE "public"."job_type";--> statement-breakpoint
CREATE TYPE "public"."job_type" AS ENUM('system_check', 'revalidation', 'connector_sync', 'file_upload_parse', 'layout_plan_commit', 'bulk_transform', 'sql_query');--> statement-breakpoint
ALTER TABLE "jobs" ALTER COLUMN "type" SET DATA TYPE "public"."job_type" USING "type"::"public"."job_type";