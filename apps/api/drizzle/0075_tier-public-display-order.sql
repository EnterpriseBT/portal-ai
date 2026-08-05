ALTER TABLE "tiers" ADD COLUMN "is_public" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "tiers" ADD COLUMN "display_order" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "tiers" ADD CONSTRAINT "tiers_public_org_check" CHECK ("tiers"."is_public" = false OR "tiers"."visible_to_organization_id" IS NULL);