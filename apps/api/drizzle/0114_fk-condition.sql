-- destructive-ok: #599 widening the condition CHECK to admit 'in_curated_view'; re-added below, no data loss
ALTER TABLE "permission_grants" DROP CONSTRAINT "permission_grants_condition_check";--> statement-breakpoint
-- destructive-ok: #599 widening the condition CHECK to admit 'in_curated_view'; re-added below, no data loss
ALTER TABLE "permission_statements" DROP CONSTRAINT "permission_statements_condition_check";--> statement-breakpoint
ALTER TABLE "permission_grants" ADD COLUMN "condition_param" text;--> statement-breakpoint
ALTER TABLE "permission_statements" ADD COLUMN "condition_param" text;--> statement-breakpoint
ALTER TABLE "permission_grants" ADD CONSTRAINT "permission_grants_condition_param_check" CHECK (("permission_grants"."condition" = 'in_curated_view') = ("permission_grants"."condition_param" IS NOT NULL));--> statement-breakpoint
ALTER TABLE "permission_grants" ADD CONSTRAINT "permission_grants_condition_check" CHECK ("permission_grants"."condition" IS NULL OR "permission_grants"."condition" IN ('created_by_caller', 'created_by_system', 'in_curated_view'));--> statement-breakpoint
ALTER TABLE "permission_statements" ADD CONSTRAINT "permission_statements_condition_param_check" CHECK (("permission_statements"."condition" = 'in_curated_view') = ("permission_statements"."condition_param" IS NOT NULL));--> statement-breakpoint
ALTER TABLE "permission_statements" ADD CONSTRAINT "permission_statements_condition_check" CHECK ("permission_statements"."condition" IS NULL OR "permission_statements"."condition" IN ('created_by_caller', 'created_by_system', 'in_curated_view'));