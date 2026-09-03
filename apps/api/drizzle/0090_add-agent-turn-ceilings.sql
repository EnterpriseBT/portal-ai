ALTER TABLE "tiers" DROP CONSTRAINT "tiers_charges_nonneg";--> statement-breakpoint
ALTER TABLE "tiers" ADD COLUMN "agent_turns_per_min" integer;--> statement-breakpoint
ALTER TABLE "tiers" ADD COLUMN "agent_turns_per_day" integer;--> statement-breakpoint
ALTER TABLE "tiers" ADD CONSTRAINT "tiers_charges_nonneg" CHECK (("tiers"."free_units_per_period" IS NULL OR "tiers"."free_units_per_period" >= 0)
        AND ("tiers"."metered_units_per_period" IS NULL OR "tiers"."metered_units_per_period" >= 0)
        AND ("tiers"."expensive_units_per_period" IS NULL OR "tiers"."expensive_units_per_period" >= 0)
        AND ("tiers"."free_rate_per_min" IS NULL OR "tiers"."free_rate_per_min" >= 0)
        AND ("tiers"."metered_rate_per_min" IS NULL OR "tiers"."metered_rate_per_min" >= 0)
        AND ("tiers"."expensive_rate_per_min" IS NULL OR "tiers"."expensive_rate_per_min" >= 0)
        AND ("tiers"."agent_turns_per_min" IS NULL OR "tiers"."agent_turns_per_min" >= 0)
        AND ("tiers"."agent_turns_per_day" IS NULL OR "tiers"."agent_turns_per_day" >= 0));