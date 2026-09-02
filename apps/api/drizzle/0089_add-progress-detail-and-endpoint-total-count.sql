ALTER TABLE "api_endpoint_configs" ADD COLUMN "total_count" jsonb;--> statement-breakpoint
ALTER TABLE "jobs" ADD COLUMN "progress_detail" jsonb;