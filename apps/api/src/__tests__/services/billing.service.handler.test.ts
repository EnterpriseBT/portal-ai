/**
 * Unit tests for `BillingService.handleSubscriptionEvent` /
 * `recordIgnoredEvent` (#176 slice 3) — the webhook tier writer.
 *
 * Converge fetch + repositories mocked; the real rollback semantics get
 * integration coverage in `stripe-webhook.integration.test.ts` (case 24).
 */

import { jest, describe, it, expect, beforeEach } from "@jest/globals";
import type Stripe from "stripe";

// ── Mocks ────────────────────────────────────────────────────────────

const mockFetchSubscription = jest.fn<(id: string) => Promise<unknown>>();
jest.unstable_mockModule("../../services/stripe.service.js", () => ({
  StripeService: { fetchSubscription: mockFetchSubscription },
}));

const mockFindByStripeCustomerId =
  jest.fn<(id: string) => Promise<Record<string, unknown> | undefined>>();
const mockOrgUpdate =
  jest.fn<(...args: unknown[]) => Promise<Record<string, unknown>>>();
const mockPriceIndex = jest.fn<() => Promise<Map<string, string>>>();
const mockInsertIfNew = jest.fn<(...args: unknown[]) => Promise<boolean>>();
const TX = { __tx: true };

jest.unstable_mockModule("../../services/db.service.js", () => ({
  DbService: {
    repository: {
      organizations: {
        findByStripeCustomerId: mockFindByStripeCustomerId,
        update: mockOrgUpdate,
      },
      tiers: { priceIndex: mockPriceIndex },
      stripeEvents: { insertIfNew: mockInsertIfNew },
    },
    transaction: (fn: (tx: unknown) => Promise<unknown>) => fn(TX),
  },
}));

const { BillingService } = await import("../../services/billing.service.js");

// ── Fixtures ─────────────────────────────────────────────────────────

const ANCHOR_JUL_15 = Date.UTC(2026, 6, 15) / 1000;

const org = {
  id: "org-1",
  tier: "standard",
  stripeCustomerId: "cus_1",
  stripeSubscriptionId: null,
  billingAnchorDay: null,
};

function subscriptionEvent(
  overrides: Record<string, unknown> = {}
): Stripe.Event {
  return {
    id: "evt_1",
    type: "customer.subscription.updated",
    data: { object: { id: "sub_1", customer: "cus_1" } },
    ...overrides,
  } as unknown as Stripe.Event;
}

function convergedSub(overrides: Record<string, unknown> = {}) {
  return {
    id: "sub_1",
    customer: "cus_1",
    status: "active",
    billing_cycle_anchor: ANCHOR_JUL_15,
    items: { data: [{ price: { id: "price_pro" } }] },
    ...overrides,
  };
}

beforeEach(() => {
  mockFetchSubscription.mockReset().mockResolvedValue(convergedSub());
  mockFindByStripeCustomerId.mockReset().mockResolvedValue({ ...org });
  mockOrgUpdate.mockReset().mockResolvedValue({});
  mockPriceIndex.mockReset().mockResolvedValue(new Map([["price_pro", "pro"]]));
  mockInsertIfNew.mockReset().mockResolvedValue(true);
});

// ── Tests (case 14) ──────────────────────────────────────────────────

describe("BillingService.handleSubscriptionEvent", () => {
  it("applied: converges, writes tier/sub-id/anchor + event row in one transaction", async () => {
    const outcome =
      await BillingService.handleSubscriptionEvent(subscriptionEvent());

    expect(outcome).toBe("applied");
    // converge read, not the event snapshot
    expect(mockFetchSubscription).toHaveBeenCalledWith("sub_1");
    // event row and org write share the SAME transaction client
    expect(mockInsertIfNew).toHaveBeenCalledWith(
      expect.objectContaining({
        eventId: "evt_1",
        type: "customer.subscription.updated",
        stripeCustomerId: "cus_1",
        stripeSubscriptionId: "sub_1",
        organizationId: "org-1",
        resultingTier: "pro",
        outcome: "applied",
      }),
      TX
    );
    expect(mockOrgUpdate).toHaveBeenCalledWith(
      "org-1",
      expect.objectContaining({
        tier: "pro",
        stripeSubscriptionId: "sub_1",
        billingAnchorDay: 15,
      }),
      TX
    );
  });

  it("terminal status reverts: standard, sub-id + anchor cleared, customer kept", async () => {
    mockFindByStripeCustomerId.mockResolvedValue({
      ...org,
      tier: "pro",
      stripeSubscriptionId: "sub_1",
      billingAnchorDay: 15,
    });
    mockFetchSubscription.mockResolvedValue(
      convergedSub({ status: "canceled" })
    );

    const outcome = await BillingService.handleSubscriptionEvent(
      subscriptionEvent({ type: "customer.subscription.deleted" })
    );

    expect(outcome).toBe("applied");
    expect(mockOrgUpdate).toHaveBeenCalledWith(
      "org-1",
      expect.objectContaining({
        tier: "standard",
        stripeSubscriptionId: null,
        billingAnchorDay: null,
      }),
      TX
    );
    // The customer id column is not touched by the update payload.
    const updateData = mockOrgUpdate.mock.calls[0][1] as Record<
      string,
      unknown
    >;
    expect(updateData).not.toHaveProperty("stripeCustomerId");
  });

  it("duplicate: insertIfNew false short-circuits — no org write", async () => {
    mockInsertIfNew.mockResolvedValue(false);

    const outcome =
      await BillingService.handleSubscriptionEvent(subscriptionEvent());

    expect(outcome).toBe("duplicate");
    expect(mockOrgUpdate).not.toHaveBeenCalled();
    // one converge fetch only — nothing beyond it
    expect(mockFetchSubscription).toHaveBeenCalledTimes(1);
  });

  it("noop: org already converged — event row records noop, org untouched", async () => {
    mockFindByStripeCustomerId.mockResolvedValue({
      ...org,
      tier: "pro",
      stripeSubscriptionId: "sub_1",
      billingAnchorDay: 15,
    });

    const outcome =
      await BillingService.handleSubscriptionEvent(subscriptionEvent());

    expect(outcome).toBe("noop");
    expect(mockOrgUpdate).not.toHaveBeenCalled();
    expect(mockInsertIfNew).toHaveBeenCalledWith(
      expect.objectContaining({ outcome: "noop", resultingTier: null }),
      TX
    );
  });

  it("unmatched: unknown customer records the outcome, org untouched, resolves (no throw)", async () => {
    mockFindByStripeCustomerId.mockResolvedValue(undefined);

    const outcome =
      await BillingService.handleSubscriptionEvent(subscriptionEvent());

    expect(outcome).toBe("unmatched");
    expect(mockOrgUpdate).not.toHaveBeenCalled();
    expect(mockInsertIfNew).toHaveBeenCalledWith(
      expect.objectContaining({
        eventId: "evt_1",
        organizationId: null,
        resultingTier: null,
        outcome: "unmatched",
      })
    );
  });

  it("throws on a converge-fetch failure (→ 500 → Stripe retry), nothing written", async () => {
    mockFetchSubscription.mockRejectedValue(new Error("stripe down"));

    await expect(
      BillingService.handleSubscriptionEvent(subscriptionEvent())
    ).rejects.toThrow("stripe down");
    expect(mockInsertIfNew).not.toHaveBeenCalled();
    expect(mockOrgUpdate).not.toHaveBeenCalled();
  });

  it("throws on a mid-transaction DB failure (retryable — rollback removes the dedup row)", async () => {
    mockOrgUpdate.mockRejectedValue(new Error("db failure"));

    await expect(
      BillingService.handleSubscriptionEvent(subscriptionEvent())
    ).rejects.toThrow("db failure");
    // The insert DID run inside the same transaction — Postgres rolls it
    // back with the failed update (integration case 24 proves it).
    expect(mockInsertIfNew).toHaveBeenCalledWith(expect.anything(), TX);
  });
});

describe("BillingService.recordIgnoredEvent", () => {
  it("records a dedup'd ignored row and resolves", async () => {
    const outcome = await BillingService.recordIgnoredEvent({
      id: "evt_2",
      type: "invoice.paid",
      data: { object: {} },
    } as unknown as Stripe.Event);

    expect(outcome).toBe("ignored");
    expect(mockInsertIfNew).toHaveBeenCalledWith(
      expect.objectContaining({
        eventId: "evt_2",
        type: "invoice.paid",
        organizationId: null,
        outcome: "ignored",
      })
    );
  });

  it("returns duplicate on redelivery", async () => {
    mockInsertIfNew.mockResolvedValue(false);

    await expect(
      BillingService.recordIgnoredEvent({
        id: "evt_2",
        type: "invoice.paid",
        data: { object: {} },
      } as unknown as Stripe.Event)
    ).resolves.toBe("duplicate");
  });
});
