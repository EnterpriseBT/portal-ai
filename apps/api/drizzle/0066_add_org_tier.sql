-- Self-sufficient backstop: ensure the default tier exists before the
-- FK-defaulted column is added, so this migration is correct in any
-- environment even if 0065's seed insert was altered. Idempotent.
INSERT INTO "tiers" (
	"id", "created", "created_by", "slug", "display_name",
	"period_kind", "period_anchor_day", "overage",
	"free_units_per_period", "free_rate_per_min",
	"metered_units_per_period", "metered_rate_per_min",
	"expensive_units_per_period", "expensive_rate_per_min",
	"per_tool_caps"
) VALUES (
	gen_random_uuid()::text, (extract(epoch from now()) * 1000)::bigint, 'SYSTEM', 'standard', 'Standard',
	'monthly', 1, 'hard-deny',
	NULL, NULL,
	1000, 20,
	100, 5,
	NULL
) ON CONFLICT ("slug") DO NOTHING;--> statement-breakpoint
-- NOT NULL DEFAULT 'standard' backfills every existing organization row.
ALTER TABLE "organizations" ADD COLUMN "tier" text DEFAULT 'standard' NOT NULL;--> statement-breakpoint
ALTER TABLE "organizations" ADD CONSTRAINT "organizations_tier_tiers_slug_fk" FOREIGN KEY ("tier") REFERENCES "public"."tiers"("slug") ON DELETE no action ON UPDATE no action;