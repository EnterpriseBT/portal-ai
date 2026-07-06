CREATE TABLE "tiers" (
	"id" text PRIMARY KEY NOT NULL,
	"created" bigint NOT NULL,
	"created_by" text NOT NULL,
	"updated" bigint,
	"updated_by" text,
	"deleted" bigint,
	"deleted_by" text,
	"slug" text NOT NULL,
	"display_name" text NOT NULL,
	"period_kind" text DEFAULT 'monthly' NOT NULL,
	"period_anchor_day" integer DEFAULT 1 NOT NULL,
	"overage" text DEFAULT 'hard-deny' NOT NULL,
	"free_units_per_period" integer,
	"free_rate_per_min" integer,
	"metered_units_per_period" integer,
	"metered_rate_per_min" integer,
	"expensive_units_per_period" integer,
	"expensive_rate_per_min" integer,
	"per_tool_caps" jsonb,
	CONSTRAINT "tiers_slug_unique" UNIQUE("slug"),
	CONSTRAINT "tiers_overage_check" CHECK ("tiers"."overage" IN ('hard-deny', 'soft-alert')),
	CONSTRAINT "tiers_period_kind_check" CHECK ("tiers"."period_kind" IN ('monthly')),
	CONSTRAINT "tiers_anchor_day_check" CHECK ("tiers"."period_anchor_day" BETWEEN 1 AND 28),
	CONSTRAINT "tiers_charges_nonneg" CHECK (("tiers"."free_units_per_period" IS NULL OR "tiers"."free_units_per_period" >= 0)
        AND ("tiers"."metered_units_per_period" IS NULL OR "tiers"."metered_units_per_period" >= 0)
        AND ("tiers"."expensive_units_per_period" IS NULL OR "tiers"."expensive_units_per_period" >= 0)
        AND ("tiers"."free_rate_per_min" IS NULL OR "tiers"."free_rate_per_min" >= 0)
        AND ("tiers"."metered_rate_per_min" IS NULL OR "tiers"."metered_rate_per_min" >= 0)
        AND ("tiers"."expensive_rate_per_min" IS NULL OR "tiers"."expensive_rate_per_min" >= 0))
);
--> statement-breakpoint
-- Seed the default `standard` tier so the table is never empty and the
-- `organizations.tier` FK added in the next migration is satisfiable in every
-- environment, regardless of whether `db:seed` has run. Idempotent. Values
-- mirror `SeedService.seedTiers` — keep the two in sync.
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
) ON CONFLICT ("slug") DO NOTHING;
