ALTER TABLE "tiers" ADD COLUMN "cta" text DEFAULT 'none' NOT NULL;--> statement-breakpoint
ALTER TABLE "tiers" ADD COLUMN "description" text;--> statement-breakpoint
ALTER TABLE "tiers" ADD COLUMN "visible_to_organization_id" text;--> statement-breakpoint
ALTER TABLE "tiers" ADD CONSTRAINT "tiers_visible_to_organization_id_organizations_id_fk" FOREIGN KEY ("visible_to_organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tiers" ADD CONSTRAINT "tiers_cta_check" CHECK ("tiers"."cta" IN ('subscribe', 'contact', 'none'));--> statement-breakpoint
ALTER TABLE "tiers" ADD CONSTRAINT "tiers_cta_price_check" CHECK ("tiers"."cta" <> 'subscribe' OR "tiers"."stripe_price_id" IS NOT NULL);