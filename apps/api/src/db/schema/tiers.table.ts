import {
  pgTable,
  text,
  integer,
  boolean,
  jsonb,
  unique,
  check,
  type AnyPgColumn,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { baseColumns } from "./base.columns.js";
import { organizations } from "./organizations.table.js";

/**
 * Subscription tiers — the per-org unit-allocation definitions (#172).
 *
 * Hybrid storage (discovery D1b): scalar columns for the fixed cost-class
 * charge grid so changing a charge is a plain SQL `UPDATE`, plus a JSONB
 * `per_tool_caps` for the one variable-length piece. A `null` charge means
 * unlimited for that class/dimension.
 *
 * Kept in sync with `TierSchema` in `@portalai/core` via `type-checks.ts`.
 */
export const tiers = pgTable(
  "tiers",
  {
    ...baseColumns,
    slug: text("slug").notNull(),
    displayName: text("display_name").notNull(),
    periodKind: text("period_kind").notNull().default("monthly"),
    periodAnchorDay: integer("period_anchor_day").notNull().default(1),
    overage: text("overage").notNull().default("hard-deny"),
    // Charge grid — nullable; NULL = unlimited (D2b).
    freeUnitsPerPeriod: integer("free_units_per_period"),
    freeRatePerMin: integer("free_rate_per_min"),
    meteredUnitsPerPeriod: integer("metered_units_per_period"),
    meteredRatePerMin: integer("metered_rate_per_min"),
    expensiveUnitsPerPeriod: integer("expensive_units_per_period"),
    expensiveRatePerMin: integer("expensive_rate_per_min"),
    perToolCaps:
      jsonb("per_tool_caps").$type<
        Record<string, { unitsPerPeriod: number }>
      >(),
    /** Stripe price mapped to this tier (#176). Null = not purchasable
     *  (standard, bespoke). */
    stripePriceId: text("stripe_price_id"),
    /** Listed in the self-serve plan list (#176). Custom/enterprise rows
     *  stay false. */
    selectable: boolean("selectable").notNull().default(false),
    /** #214: explicit allowlist of built-in pack slugs. Fail-closed
     *  default — a row inserted without it grants no built-in packs. */
    builtinToolpacks: jsonb("builtin_toolpacks")
      .$type<string[]>()
      .notNull()
      .default([]),
    /** #214: custom (webhook) toolpack entitlement. Fail-closed default. */
    customToolpacks: boolean("custom_toolpacks").notNull().default(false),
    /** #241: the single source of truth for the Settings card's action —
     *  `subscribe | contact | none` (CHECK-constrained below). Default `none`
     *  is the fail-closed baseline (no CTA); `tier apply` converges it from the
     *  catalog. */
    cta: text("cta").notNull().default("none"),
    /** #241: operator-authored plan blurb. Nullable; excluded from `tier apply`
     *  convergence so operator copy is never clobbered. */
    description: text("description"),
    /** #241: per-client custom-tier scoping. NULL = public (all orgs); set =
     *  private to that one org. Nullable FK → organizations.id (closes a cyclic
     *  FK with organizations.tier → tiers.slug; both nullable/defaulted). */
    visibleToOrganizationId: text("visible_to_organization_id").references(
      // `AnyPgColumn` return annotation breaks the type-level recursion of the
      // cyclic FK (organizations.tier → tiers.slug and back); without it TS
      // degrades `organizations`'s inferred row type to `Record<string, any>`.
      (): AnyPgColumn => organizations.id
    ),
  },
  (t) => [
    // FULL unique CONSTRAINT (not a soft-delete-partial index): `slug` is the
    // FK target of `organizations.tier`, and Postgres requires a non-partial
    // UNIQUE for a referenced column. A soft-deleted tier's slug therefore
    // cannot be reused — acceptable: tiers are rarely deleted and never while
    // an org references one (the FK blocks it).
    unique("tiers_slug_unique").on(t.slug),
    // PG UNIQUE ignores NULLs — "unique where not null" (#176 D1).
    unique("tiers_stripe_price_id_unique").on(t.stripePriceId),
    check(
      "tiers_overage_check",
      sql`${t.overage} IN ('hard-deny', 'soft-alert')`
    ),
    check("tiers_period_kind_check", sql`${t.periodKind} IN ('monthly')`),
    check("tiers_anchor_day_check", sql`${t.periodAnchorDay} BETWEEN 1 AND 28`),
    // #241: the card CTA vocabulary.
    check("tiers_cta_check", sql`${t.cta} IN ('subscribe', 'contact', 'none')`),
    // #241: a `subscribe` card must resolve a price — the invariant `tier
    // apply` enforces (fail-closed) made durable at the DB.
    check(
      "tiers_cta_price_check",
      sql`${t.cta} <> 'subscribe' OR ${t.stripePriceId} IS NOT NULL`
    ),
    check(
      "tiers_charges_nonneg",
      sql`(${t.freeUnitsPerPeriod} IS NULL OR ${t.freeUnitsPerPeriod} >= 0)
        AND (${t.meteredUnitsPerPeriod} IS NULL OR ${t.meteredUnitsPerPeriod} >= 0)
        AND (${t.expensiveUnitsPerPeriod} IS NULL OR ${t.expensiveUnitsPerPeriod} >= 0)
        AND (${t.freeRatePerMin} IS NULL OR ${t.freeRatePerMin} >= 0)
        AND (${t.meteredRatePerMin} IS NULL OR ${t.meteredRatePerMin} >= 0)
        AND (${t.expensiveRatePerMin} IS NULL OR ${t.expensiveRatePerMin} >= 0)`
    ),
  ]
);
