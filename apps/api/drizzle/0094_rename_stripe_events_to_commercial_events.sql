-- #568: generalize the Stripe-specific dedup store into a source-agnostic
-- `commercial_events` store, so AWS Marketplace (and later GCP/Azure) share the
-- same `TierGrantService.apply` dedup+audit table. A RENAME (not drop/create)
-- preserves every existing Stripe row, which becomes `source = 'stripe'`.
--
-- The dedup arbiter moves from `event_id` alone to the `(source, external_id)`
-- pair — the same external id may legitimately recur across sources.
ALTER TABLE "stripe_events" RENAME TO "commercial_events";--> statement-breakpoint
ALTER TABLE "commercial_events" RENAME COLUMN "event_id" TO "external_id";--> statement-breakpoint
ALTER TABLE "commercial_events" RENAME CONSTRAINT "stripe_events_organization_id_organizations_id_fk" TO "commercial_events_organization_id_organizations_id_fk";--> statement-breakpoint
ALTER TABLE "commercial_events" DROP CONSTRAINT "stripe_events_event_id_unique";--> statement-breakpoint
ALTER TABLE "commercial_events" DROP CONSTRAINT "stripe_events_outcome_check";--> statement-breakpoint
ALTER TABLE "commercial_events" ADD COLUMN "source" text DEFAULT 'stripe' NOT NULL;--> statement-breakpoint
ALTER TABLE "commercial_events" ALTER COLUMN "source" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "commercial_events" ADD CONSTRAINT "commercial_events_source_external_id_unique" UNIQUE("source","external_id");--> statement-breakpoint
ALTER TABLE "commercial_events" ADD CONSTRAINT "commercial_events_source_check" CHECK ("commercial_events"."source" IN ('stripe', 'aws_marketplace'));--> statement-breakpoint
ALTER TABLE "commercial_events" ADD CONSTRAINT "commercial_events_outcome_check" CHECK ("commercial_events"."outcome" IN ('applied', 'noop', 'unmatched', 'ignored', 'foreign'));
