import { describe, it, expect } from "@jest/globals";

import {
  formatAllocation,
  formatOverage,
  formatPeriod,
  formatPerToolCaps,
  formatPrice,
  entitlementPackNames,
} from "../utils/tier-format.util";

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
