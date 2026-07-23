import { BUILTIN_TOOLPACK_BY_SLUG } from "@portalai/core/registries";

import type { BillingTier } from "@portalai/core/contracts";

/**
 * Pure, presentational formatters for the billing tier cards (#241). Every
 * policy dimension the contract carries gets a human string here so the card
 * component stays declarative. `null` (unlimited) is rendered "Unlimited"
 * throughout.
 */

type TierPolicy = BillingTier["policy"];
type Allocation = TierPolicy["allocations"]["free"];

/** The single shared support channel (also used by Help). */
export const SUPPORT_MAILTO = "mailto:ben.turner@btdev.io";

const nf = new Intl.NumberFormat();

/** "$49 / month" from a live price; "—" when display-degraded (Stripe outage). */
export const formatPrice = (price: BillingTier["price"]): string => {
  if (!price) return "—";
  const amount = new Intl.NumberFormat(undefined, {
    style: "currency",
    currency: price.currency.toUpperCase(),
    minimumFractionDigits: price.unitAmount % 100 === 0 ? 0 : 2,
  }).format(price.unitAmount / 100);
  return `${amount} / ${price.interval}`;
};

/** One cost class: units/period + per-minute rate. `null` = "Unlimited". */
export const formatAllocation = (a: Allocation): string => {
  const units =
    a.unitsPerPeriod === null
      ? "Unlimited"
      : `${nf.format(a.unitsPerPeriod)} units / period`;
  const rate =
    a.ratePerMin === null ? null : `${nf.format(a.ratePerMin)} / min`;
  return rate ? `${units} · ${rate}` : units;
};

/** "Monthly" for the v1 period kind. */
export const formatPeriod = (period: TierPolicy["period"]): string =>
  period.kind === "monthly" ? "Monthly" : period.kind;

/** Human overage behavior. */
export const formatOverage = (overage: TierPolicy["overage"]): string =>
  overage === "hard-deny" ? "Stops at the limit" : "Alerts, keeps going";

/** Per-tool caps as display rows (empty when none). */
export const formatPerToolCaps = (caps: TierPolicy["perToolCaps"]): string[] =>
  caps
    ? Object.entries(caps).map(
        ([tool, c]) => `${tool}: ${nf.format(c.unitsPerPeriod)} / period`
      )
    : [];

/** Display order for the plan grid (#260): free first, then priced tiers by
 *  ascending price, then contact/custom last — i.e. Standard → Plus → Pro →
 *  Enterprise. Pure; returns a new array. */
const CTA_ORDER: Record<BillingTier["cta"], number> = {
  none: 0,
  subscribe: 1,
  contact: 2,
};
export const sortTiersForDisplay = (tiers: BillingTier[]): BillingTier[] =>
  [...tiers].sort((a, b) => {
    const byCta = (CTA_ORDER[a.cta] ?? 1) - (CTA_ORDER[b.cta] ?? 1);
    if (byCta !== 0) return byCta;
    return (
      (a.price?.unitAmount ?? Number.MAX_SAFE_INTEGER) -
      (b.price?.unitAmount ?? Number.MAX_SAFE_INTEGER)
    );
  });

/** Built-in toolpack entitlement slugs → human pack display names. An unknown
 *  slug (a pack shipping in a later deploy) falls through to the raw slug. */
export const entitlementPackNames = (slugs: string[]): string[] => {
  const bySlug = BUILTIN_TOOLPACK_BY_SLUG as Record<
    string,
    { name: string } | undefined
  >;
  return slugs.map((s) => bySlug[s]?.name ?? s);
};
