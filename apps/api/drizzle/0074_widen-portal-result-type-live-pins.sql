ALTER TYPE "public"."portal_result_type" ADD VALUE 'd3';--> statement-breakpoint
ALTER TYPE "public"."portal_result_type" ADD VALUE 'geo';--> statement-breakpoint
ALTER TABLE "portal_results" ADD COLUMN "snapshot_updated_at" bigint;