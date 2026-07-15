/**
 * Unit tests for `BillingService.deriveTierFromSubscription` (#176 slice 2) —
 * the pure Decision-3 status table. No I/O; the Stripe SDK never loads.
 */

import { describe, it, expect } from "@jest/globals";

const { BillingService } = await import("../../services/billing.service.js");

// ── Fixtures ─────────────────────────────────────────────────────────

/** price → tier-slug index (what the webhook builds from `tiers` rows). */
const priceIndex = new Map([
  ["price_pro", "pro"],
  ["price_scale", "scale"],
]);

/** 2026-07-15T00:00:00Z → anchor day 15. */
const ANCHOR_JUL_15 = Date.UTC(2026, 6, 15) / 1000;
/** 2026-01-31T12:00:00Z → clamps to 28. */
const ANCHOR_JAN_31 = Date.UTC(2026, 0, 31, 12) / 1000;

function sub(
  overrides: Partial<{
    status: string;
    priceId: string | null;
    billingCycleAnchor: number;
  }> = {}
) {
  return {
    status: "active",
    priceId: "price_pro",
    billingCycleAnchor: ANCHOR_JUL_15,
    ...overrides,
  };
}

// ── Tests (case 10: the six status-table rows) ───────────────────────

describe("BillingService.deriveTierFromSubscription", () => {
  it("active + known price → mapped tier, live, anchored", () => {
    expect(
      BillingService.deriveTierFromSubscription(sub(), priceIndex, "standard")
    ).toEqual({ tier: "pro", subscriptionLive: true, anchorDay: 15 });
  });

  it("trialing + known price → mapped tier, live, anchored", () => {
    expect(
      BillingService.deriveTierFromSubscription(
        sub({ status: "trialing", priceId: "price_scale" }),
        priceIndex,
        "standard"
      )
    ).toEqual({ tier: "scale", subscriptionLive: true, anchorDay: 15 });
  });

  it("active + unknown price → keeps the current tier (warn), live, anchored", () => {
    expect(
      BillingService.deriveTierFromSubscription(
        sub({ priceId: "price_unmapped" }),
        priceIndex,
        "pro"
      )
    ).toEqual({ tier: "pro", subscriptionLive: true, anchorDay: 15 });
  });

  it("active + null price → keeps the current tier, live, anchored", () => {
    expect(
      BillingService.deriveTierFromSubscription(
        sub({ priceId: null }),
        priceIndex,
        "pro"
      )
    ).toEqual({ tier: "pro", subscriptionLive: true, anchorDay: 15 });
  });

  it("past_due → keeps the paid tier (Stripe dunning owns grace), live, anchored", () => {
    expect(
      BillingService.deriveTierFromSubscription(
        sub({ status: "past_due" }),
        priceIndex,
        "pro"
      )
    ).toEqual({ tier: "pro", subscriptionLive: true, anchorDay: 15 });
  });

  it.each(["canceled", "unpaid", "incomplete_expired"])(
    "%s → standard, subscription cleared, anchor cleared",
    (status) => {
      expect(
        BillingService.deriveTierFromSubscription(
          sub({ status }),
          priceIndex,
          "pro"
        )
      ).toEqual({ tier: "standard", subscriptionLive: false, anchorDay: null });
    }
  );

  it("an unrecognized status keeps the current tier (never grants, never revokes)", () => {
    expect(
      BillingService.deriveTierFromSubscription(
        sub({ status: "paused" }),
        priceIndex,
        "pro"
      )
    ).toEqual({ tier: "pro", subscriptionLive: true, anchorDay: 15 });
  });

  // ── case 11: anchor clamp ─────────────────────────────────────────

  it("clamps a 31st-of-month billing anchor to day 28", () => {
    expect(
      BillingService.deriveTierFromSubscription(
        sub({ billingCycleAnchor: ANCHOR_JAN_31 }),
        priceIndex,
        "standard"
      )
    ).toEqual({ tier: "pro", subscriptionLive: true, anchorDay: 28 });
  });

  it("terminal state clears the anchor even with a valid billing anchor set", () => {
    expect(
      BillingService.deriveTierFromSubscription(
        sub({ status: "canceled", billingCycleAnchor: ANCHOR_JAN_31 }),
        priceIndex,
        "pro"
      ).anchorDay
    ).toBeNull();
  });
});
