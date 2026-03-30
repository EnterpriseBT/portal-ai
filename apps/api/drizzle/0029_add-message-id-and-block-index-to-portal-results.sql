ALTER TABLE "portal_results" ALTER COLUMN "type" SET DATA TYPE text;--> statement-breakpoint
DROP TYPE "public"."portal_result_type";--> statement-breakpoint
CREATE TYPE "public"."portal_result_type" AS ENUM('text', 'vega-lite', 'vega', 'data-table');--> statement-breakpoint
ALTER TABLE "portal_results" ALTER COLUMN "type" SET DATA TYPE "public"."portal_result_type" USING "type"::"public"."portal_result_type";--> statement-breakpoint
ALTER TABLE "portal_results" ADD COLUMN "message_id" text;--> statement-breakpoint
ALTER TABLE "portal_results" ADD COLUMN "block_index" integer;