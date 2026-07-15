CREATE TABLE "stripe_events" (
	"id" text PRIMARY KEY NOT NULL,
	"created" bigint NOT NULL,
	"created_by" text NOT NULL,
	"updated" bigint,
	"updated_by" text,
	"deleted" bigint,
	"deleted_by" text,
	"event_id" text NOT NULL,
	"type" text NOT NULL,
	"stripe_customer_id" text,
	"stripe_subscription_id" text,
	"organization_id" text,
	"resulting_tier" text,
	"outcome" text NOT NULL,
	CONSTRAINT "stripe_events_event_id_unique" UNIQUE("event_id"),
	CONSTRAINT "stripe_events_outcome_check" CHECK ("stripe_events"."outcome" IN ('applied', 'noop', 'unmatched', 'ignored'))
);
--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN "stripe_customer_id" text;--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN "stripe_subscription_id" text;--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN "billing_anchor_day" integer;--> statement-breakpoint
ALTER TABLE "tiers" ADD COLUMN "stripe_price_id" text;--> statement-breakpoint
ALTER TABLE "tiers" ADD COLUMN "selectable" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "stripe_events" ADD CONSTRAINT "stripe_events_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organizations" ADD CONSTRAINT "organizations_stripe_customer_id_unique" UNIQUE("stripe_customer_id");--> statement-breakpoint
ALTER TABLE "organizations" ADD CONSTRAINT "organizations_stripe_subscription_id_unique" UNIQUE("stripe_subscription_id");--> statement-breakpoint
ALTER TABLE "tiers" ADD CONSTRAINT "tiers_stripe_price_id_unique" UNIQUE("stripe_price_id");--> statement-breakpoint
ALTER TABLE "organizations" ADD CONSTRAINT "organizations_anchor_day_check" CHECK ("organizations"."billing_anchor_day" IS NULL OR "organizations"."billing_anchor_day" BETWEEN 1 AND 28);--> statement-breakpoint
-- Hand-added backfill (#176): the free plan must appear in the self-serve
-- plan list from day one. Mirrors `seedTiers` in seed.service.ts (which
-- also converges existing rows — keep the two in sync).
UPDATE "tiers" SET "selectable" = true WHERE "slug" = 'standard';