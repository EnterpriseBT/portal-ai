ALTER TABLE "organizations" ADD COLUMN "marketplace_entitlement_id" text;--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN "entitlement_through" bigint;--> statement-breakpoint
ALTER TABLE "organizations" ADD CONSTRAINT "organizations_marketplace_entitlement_id_unique" UNIQUE("marketplace_entitlement_id");