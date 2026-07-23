import { describe, it, expect } from "@jest/globals";

import {
  formatAllocation,
  formatOverage,
  formatPeriod,
  formatPerToolCaps,
  formatPrice,
  entitlementPackNames,
  sortTiersForDisplay,
} from "../utils/tier-format.util";

import type { BillingTier } from "@portalai/core/contracts";

// ── case 22: pure formatters ─────────────────────────────────────────

describe("formatAllocation", () => {
  it("renders units + per-minute rate", () => {
    expect(formatAllocation({ unitsPerPeriod: 1000, ratePerMin: 20 })).toBe(
      "1,000 units / period · 20 / min"
    );
  });

  it("renders Unlimited for null (both dimensions)", () => {
    expect(formatAllocation({ unitsPerPeriod: null, ratePerMin: null })).toBe(
      "Unlimited"
    );
  });

  it("renders Unlimited units with a finite rate", () => {
    expect(formatAllocation({ unitsPerPeriod: null, ratePerMin: 5 })).toBe(
      "Unlimited · 5 / min"
    );
  });
});

describe("formatPeriod / formatOverage", () => {
  it("formats the monthly period", () => {
    expect(formatPeriod({ kind: "monthly", anchorDay: 1 })).toBe("Monthly");
  });

  it("formats overage behavior", () => {
    expect(formatOverage("hard-deny")).toBe("Stops at the limit");
    expect(formatOverage("soft-alert")).toBe("Alerts, keeps going");
  });
});

describe("formatPerToolCaps", () => {
  it("renders each cap; empty for null", () => {
    expect(formatPerToolCaps(null)).toEqual([]);
    expect(formatPerToolCaps({ web_search: { unitsPerPeriod: 500 } })).toEqual([
      "web_search: 500 / period",
    ]);
  });
});

describe("formatPrice", () => {
  it("formats a live price; em-dash when degraded (null)", () => {
    expect(
      formatPrice({ unitAmount: 4900, currency: "usd", interval: "month" })
    ).toBe("$49 / month");
    expect(formatPrice(null)).toBe("—");
  });
});

describe("entitlementPackNames", () => {
  it("maps known slugs to display names; unknown slug falls through", () => {
    expect(entitlementPackNames(["data_query"])).toEqual(["Data Query"]);
    expect(entitlementPackNames(["not_a_pack"])).toEqual(["not_a_pack"]);
  });
});

describe("sortTiersForDisplay", () => {
  // Only `cta` and `price.unitAmount` drive the sort; the rest is filler.
  const tier = (
    slug: string,
    cta: BillingTier["cta"],
    unitAmount: number | null
  ): BillingTier =>
    ({
      slug,
      cta,
      price:
        unitAmount === null
          ? null
          : { unitAmount, currency: "usd", interval: "month" },
    }) as BillingTier;

  it("orders free → priced ascending → contact, regardless of input order", () => {
    const enterprise = tier("enterprise", "contact", null);
    const pro = tier("pro", "subscribe", 4900);
    const standard = tier("standard", "none", null);
    const plus = tier("plus", "subscribe", 1900);

    // Deliberately scrambled (creation-order from the DB, not price-order).
    const sorted = sortTiersForDisplay([pro, enterprise, standard, plus]);

    expect(sorted.map((t) => t.slug)).toEqual([
      "standard",
      "plus",
      "pro",
      "enterprise",
    ]);
  });

  it("does not mutate the input array", () => {
    const input = [
      tier("pro", "subscribe", 4900),
      tier("standard", "none", null),
    ];
    const before = input.map((t) => t.slug);
    sortTiersForDisplay(input);
    expect(input.map((t) => t.slug)).toEqual(before);
  });
});
