ALTER TABLE "jobs" ALTER COLUMN "type" SET DATA TYPE text;--> statement-breakpoint
DROP TYPE "public"."job_type";--> statement-breakpoint
CREATE TYPE "public"."job_type" AS ENUM('file_upload', 'system_check');--> statement-breakpoint
ALTER TABLE "jobs" ALTER COLUMN "type" SET DATA TYPE "public"."job_type" USING "type"::"public"."job_type";