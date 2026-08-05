/**
 * Unit tests for `BillingService` — the pure Decision-3 status table
 * (`deriveTierFromSubscription`, #176 slice 2) and the `price.*` →
 * site-rebuild fan-out on `recordIgnoredEvent` (#311 slice 4).
 *
 * Still no real I/O: the repository and the dispatch service are mocked, so
 * the Stripe SDK and a database never load.
 */

import { jest, describe, it, expect, beforeEach } from "@jest/globals";

const mockInsertIfNew = jest.fn<(row: unknown) => Promise<boolean>>();
jest.unstable_mockModule("../../services/db.service.js", () => ({
  DbService: {
    repository: { stripeEvents: { insertIfNew: mockInsertIfNew } },
  },
}));

const mockFireSiteRebuild = jest.fn<(reason: string) => Promise<void>>();
jest.unstable_mockModule("../../services/rebuild-dispatch.service.js", () => ({
  RebuildDispatchService: { fireSiteRebuild: mockFireSiteRebuild },
}));

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

  // #218 rotation pin: after a Stripe-side price rotation
  // (transfer_lookup_key → tier apply re-points the row), in-flight
  // subscriptions still carry the OLD price id, which priceIndex no longer
  // maps. The webhook must degrade gracefully — warn-and-keep, never a
  // tier flip or a throw.
  it("post-rotation: an old (rotated-away) price id keeps the org's tier", () => {
    const postRotationIndex = new Map([["price_pro_v2", "pro"]]); // v1 gone
    expect(
      BillingService.deriveTierFromSubscription(
        sub({ priceId: "price_pro_v1" }),
        postRotationIndex,
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

// ── #311 slice 4: price events fan out to a site rebuild ─────────────

describe("BillingService.recordIgnoredEvent — site-rebuild fan-out (#311)", () => {
  /** A verified Stripe event of `type`, shaped like the webhook's payload. */
  function priceEvent(type: string, id = `evt_${type}`) {
    return {
      id,
      type,
      data: { object: { id: "price_pro", object: "price" } },
    } as unknown as Parameters<typeof BillingService.recordIgnoredEvent>[0];
  }

  beforeEach(() => {
    mockInsertIfNew.mockReset();
    mockFireSiteRebuild.mockReset();
    mockInsertIfNew.mockResolvedValue(true);
    mockFireSiteRebuild.mockResolvedValue(undefined);
  });

  it("still records price.updated as `ignored` — webhook semantics unchanged", async () => {
    await expect(
      BillingService.recordIgnoredEvent(priceEvent("price.updated"))
    ).resolves.toBe("ignored");

    // The row's outcome is what the audit trail keys off.
    const row = mockInsertIfNew.mock.calls[0][0] as { outcome: string };
    expect(row.outcome).toBe("ignored");
  });

  it.each(["price.created", "price.updated", "price.deleted"])(
    "fires a site rebuild for %s",
    async (type) => {
      await BillingService.recordIgnoredEvent(priceEvent(type));
      expect(mockFireSiteRebuild).toHaveBeenCalledWith(`stripe:${type}`);
    }
  );

  it("does not fire for an unrelated ignored event", async () => {
    await BillingService.recordIgnoredEvent(priceEvent("invoice.paid"));
    expect(mockFireSiteRebuild).not.toHaveBeenCalled();
  });

  it("does not fire on a redelivery (dedup returns duplicate)", async () => {
    mockInsertIfNew.mockResolvedValue(false);

    await expect(
      BillingService.recordIgnoredEvent(priceEvent("price.updated"))
    ).resolves.toBe("duplicate");
    expect(mockFireSiteRebuild).not.toHaveBeenCalled();
  });

  it("a dispatch failure never fails the webhook", async () => {
    // Defensive: the service swallows its own errors, but the webhook must
    // survive even if that contract is ever broken upstream.
    mockFireSiteRebuild.mockRejectedValue(new Error("github down"));

    await expect(
      BillingService.recordIgnoredEvent(priceEvent("price.updated"))
    ).resolves.toBe("ignored");
  });
});
