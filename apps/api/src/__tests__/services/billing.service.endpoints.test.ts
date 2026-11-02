/**
 * Unit tests for `BillingService` checkout/portal logic (#176 slice 4,
 * cases 15–17) — the guard ladder in spec order, lazy customer creation,
 * and the portal guards. Stripe SDK + repositories mocked.
 */

import { jest, describe, it, expect, beforeEach } from "@jest/globals";
import type { OrgRole } from "@portalai/core/models";

// ── Mocks ────────────────────────────────────────────────────────────

const mockIsConfigured = jest.fn<() => boolean>();
const mockCreateCustomer =
  jest.fn<(args: unknown) => Promise<{ id: string }>>();
const mockCreateCheckoutSession =
  jest.fn<(args: unknown) => Promise<{ url: string }>>();
const mockCreatePortalSession =
  jest.fn<(args: unknown) => Promise<{ url: string }>>();
const mockGetPrice = jest.fn<(id: string) => Promise<unknown>>();
const mockFetchSubscription = jest.fn<(id: string) => Promise<unknown>>();
const mockListSubscriptions =
  jest.fn<(customerId: string) => Promise<unknown[]>>();
const mockListOpenCheckoutSessions =
  jest.fn<(customerId: string) => Promise<string[]>>();
const mockExpireCheckoutSession = jest.fn<(id: string) => Promise<boolean>>();
const mockDeleteCustomer = jest.fn<(id: string) => Promise<void>>();
const mockUpdateCustomerName =
  jest.fn<(customerId: string, name: string) => Promise<void>>();

jest.unstable_mockModule("../../services/stripe.service.js", () => ({
  StripeService: {
    isConfigured: mockIsConfigured,
    createCustomer: mockCreateCustomer,
    createCheckoutSession: mockCreateCheckoutSession,
    createPortalSession: mockCreatePortalSession,
    getPrice: mockGetPrice,
    fetchSubscription: mockFetchSubscription,
    updateCustomerName: mockUpdateCustomerName,
    listSubscriptions: mockListSubscriptions,
    listOpenCheckoutSessions: mockListOpenCheckoutSessions,
    expireCheckoutSession: mockExpireCheckoutSession,
    deleteCustomer: mockDeleteCustomer,
  },
}));

const mockFindBySlug =
  jest.fn<(slug: string) => Promise<Record<string, unknown> | undefined>>();
const mockPriceIndex = jest.fn<() => Promise<Map<string, string>>>();
const mockFindSelectableForOrg =
  jest.fn<(orgId: string) => Promise<Record<string, unknown>[]>>();
// #939: checkout re-reads the org and stores a new customer id with a
// conditional write, both inside its locked transaction.
const mockOrgFindById =
  jest.fn<
    (...args: unknown[]) => Promise<Record<string, unknown> | undefined>
  >();
const mockOrgUpdateWhere =
  jest.fn<(...args: unknown[]) => Promise<Record<string, unknown>[]>>();
const mockExecute = jest.fn<(query: unknown) => Promise<unknown>>();
// #939: the sync locks the org row, then writes the plan and a ledger row.
const mockOrgFindByIdForUpdate =
  jest.fn<
    (...args: unknown[]) => Promise<Record<string, unknown> | undefined>
  >();
const mockOrgUpdate = jest.fn<(...args: unknown[]) => Promise<unknown>>();
const mockInsertIfNew = jest.fn<(...args: unknown[]) => Promise<boolean>>();
const TX = { execute: mockExecute };

jest.unstable_mockModule("../../services/db.service.js", () => ({
  DbService: {
    repository: {
      organizations: {
        findById: mockOrgFindById,
        findByIdForUpdate: mockOrgFindByIdForUpdate,
        update: mockOrgUpdate,
        updateWhere: mockOrgUpdateWhere,
      },
      commercialEvents: { insertIfNew: mockInsertIfNew },
      tiers: {
        findBySlug: mockFindBySlug,
        findSelectableForOrg: mockFindSelectableForOrg,
        priceIndex: mockPriceIndex,
      },
    },
    transaction: (fn: (tx: unknown) => Promise<unknown>) => fn(TX),
  },
}));

// #598: BillingService now calls the async, DB-backed PermissionService.check.
// This unit suite tests billing logic + guard ORDER, not authz resolution
// (the engine has its own tests), so mock the guard to the billing.manage
// owner-only rule without touching the DB.
jest.unstable_mockModule("../../services/permission.service.js", () => ({
  PermissionService: {
    check: jest.fn(
      async (caller: { roles?: string[] }, action: string): Promise<void> => {
        if (action === "billing.manage" && !caller?.roles?.includes("owner")) {
          const { ApiError } = await import("../../services/http.service.js");
          const { ApiCode } =
            await import("../../constants/api-codes.constants.js");
          throw new ApiError(
            403,
            ApiCode.PERMISSION_DENIED,
            "You don't have permission to manage billing."
          );
        }
      }
    ),
  },
}));

// Env stub controls the settings-URL base; logger + namespace fields keep
// transitive imports bootable.
jest.unstable_mockModule("../../environment.js", () => ({
  environment: {
    NODE_ENV: "test",
    LOG_LEVEL: "silent",
    LOG_FORMAT: "json",
    CORS_ORIGIN: ["http://app.test"],
    // #939: the sync's ledger row is created by the system actor.
    SYSTEM_ID: "system-test",
  },
}));

const { BillingService } = await import("../../services/billing.service.js");

// ── Fixtures ─────────────────────────────────────────────────────────

const OWNER_ID = "user-owner";
const MEMBER_ID = "user-member";
// #576: BillingService now takes a PermissionContext caller; billing.manage is
// owner-only, so the caller's role is what the guard reads.
const OWNER = {
  userId: OWNER_ID,
  organizationId: "org-fixture",
  roles: ["owner"] as OrgRole[],
};
const MEMBER = {
  userId: MEMBER_ID,
  organizationId: "org-fixture",
  roles: ["member"] as OrgRole[],
};

function orgFixture(overrides: Record<string, unknown> = {}) {
  return {
    id: "org-1",
    name: "Acme Corp",
    ownerUserId: OWNER_ID,
    tier: "standard",
    stripeCustomerId: null,
    stripeSubscriptionId: null,
    billingAnchorDay: null,
    ...overrides,
  } as never;
}

function tierRow(slug: string, overrides: Record<string, unknown> = {}) {
  return {
    id: `tier-${slug}`,
    slug,
    displayName: slug,
    periodKind: "monthly",
    periodAnchorDay: 1,
    overage: "hard-deny",
    freeUnitsPerPeriod: null,
    freeRatePerMin: null,
    meteredUnitsPerPeriod: 1000,
    meteredRatePerMin: 20,
    expensiveUnitsPerPeriod: 100,
    expensiveRatePerMin: 5,
    perToolCaps: null,
    stripePriceId: null,
    selectable: false,
    builtinToolpacks: ["data_query"],
    customToolpacks: true,
    cta: "none",
    description: null,
    visibleToOrganizationId: null,
    ...overrides,
  };
}

const standardTier = tierRow("standard", { selectable: true });
const proTier = tierRow("pro", {
  selectable: true,
  stripePriceId: "price_pro",
  cta: "subscribe",
  description: "Everything in Standard, plus more.",
});

beforeEach(() => {
  mockIsConfigured.mockReset().mockReturnValue(true);
  mockCreateCustomer.mockReset().mockResolvedValue({ id: "cus_new" });
  mockCreateCheckoutSession
    .mockReset()
    .mockResolvedValue({ url: "https://checkout.stripe.com/c/session" });
  mockCreatePortalSession
    .mockReset()
    .mockResolvedValue({ url: "https://billing.stripe.com/p/session" });
  mockGetPrice.mockReset().mockResolvedValue({
    unitAmount: 4900,
    currency: "usd",
    interval: "month",
  });
  mockFindBySlug.mockReset().mockImplementation(async (slug: string) => {
    if (slug === "standard") return standardTier;
    if (slug === "pro") return proTier;
    return undefined;
  });
  mockFindSelectableForOrg
    .mockReset()
    .mockResolvedValue([standardTier, proTier]);
  mockOrgFindById.mockReset().mockResolvedValue(undefined);
  mockOrgUpdateWhere.mockReset().mockResolvedValue([{ name: "Acme Corp" }]);
  mockExecute.mockReset().mockResolvedValue([]);
  mockOrgFindByIdForUpdate.mockReset().mockResolvedValue(undefined);
  mockOrgUpdate.mockReset().mockResolvedValue({});
  mockInsertIfNew.mockReset().mockResolvedValue(true);
  mockPriceIndex.mockReset().mockResolvedValue(new Map([["price_pro", "pro"]]));
  mockListSubscriptions.mockReset().mockResolvedValue([]);
  mockListOpenCheckoutSessions.mockReset().mockResolvedValue([]);
  mockExpireCheckoutSession.mockReset().mockResolvedValue(true);
  mockDeleteCustomer.mockReset().mockResolvedValue(undefined);
  mockUpdateCustomerName.mockReset().mockResolvedValue(undefined);
  mockFetchSubscription
    .mockReset()
    .mockResolvedValue({ items: { data: [{ id: "si_1" }] } });
});

// ── case 15: checkout guard ladder, in spec order ────────────────────

describe("BillingService.createCheckout guards", () => {
  it("503 BILLING_NOT_CONFIGURED first — even for a non-owner", async () => {
    mockIsConfigured.mockReturnValue(false);

    await expect(
      BillingService.createCheckout(orgFixture(), MEMBER, "pro")
    ).rejects.toMatchObject({ status: 503, code: "BILLING_NOT_CONFIGURED" });
  });

  it("403 PERMISSION_DENIED before the subscribed check", async () => {
    await expect(
      BillingService.createCheckout(
        orgFixture({ stripeSubscriptionId: "sub_1" }),
        MEMBER,
        "pro"
      )
    ).rejects.toMatchObject({ status: 403, code: "PERMISSION_DENIED" });
  });

  it("409 BILLING_ALREADY_SUBSCRIBED when a live subscription exists (Q1)", async () => {
    await expect(
      BillingService.createCheckout(
        orgFixture({ stripeSubscriptionId: "sub_1", tier: "pro" }),
        OWNER,
        "pro"
      )
    ).rejects.toMatchObject({
      status: 409,
      code: "BILLING_ALREADY_SUBSCRIBED",
    });
  });

  it("409 BILLING_TIER_MANAGED for a custom-tier org with no subscription (D5)", async () => {
    mockFindBySlug.mockImplementation(async (slug: string) =>
      slug === "enterprise-acme"
        ? tierRow("enterprise-acme", { selectable: false })
        : undefined
    );

    await expect(
      BillingService.createCheckout(
        orgFixture({ tier: "enterprise-acme" }),
        OWNER,
        "pro"
      )
    ).rejects.toMatchObject({ status: 409, code: "BILLING_TIER_MANAGED" });
    // Server-blocked, not just hidden UI — no session was minted.
    expect(mockCreateCheckoutSession).not.toHaveBeenCalled();
  });

  it("404 BILLING_TIER_NOT_FOUND for an unknown or unlisted tier", async () => {
    await expect(
      BillingService.createCheckout(orgFixture(), OWNER, "bogus")
    ).rejects.toMatchObject({ status: 404, code: "BILLING_TIER_NOT_FOUND" });

    mockFindBySlug.mockImplementation(async (slug: string) =>
      slug === "standard"
        ? standardTier
        : slug === "hidden"
          ? tierRow("hidden", { selectable: false, stripePriceId: "price_h" })
          : undefined
    );
    await expect(
      BillingService.createCheckout(orgFixture(), OWNER, "hidden")
    ).rejects.toMatchObject({ status: 404, code: "BILLING_TIER_NOT_FOUND" });
  });

  it("400 BILLING_TIER_NOT_PURCHASABLE for a selectable but priceless tier", async () => {
    await expect(
      BillingService.createCheckout(orgFixture(), OWNER, "standard")
    ).rejects.toMatchObject({
      status: 400,
      code: "BILLING_TIER_NOT_PURCHASABLE",
    });
  });
});

// ── case 16: checkout happy path + lazy customer ─────────────────────

describe("BillingService.createCheckout happy path", () => {
  it("lazily creates the customer once, persists the id, returns the session URL", async () => {
    const result = await BillingService.createCheckout(
      orgFixture(),
      OWNER,
      "pro"
    );

    expect(result).toEqual({ url: "https://checkout.stripe.com/c/session" });
    expect(mockCreateCustomer).toHaveBeenCalledTimes(1);
    expect(mockCreateCustomer).toHaveBeenCalledWith({
      organizationId: "org-1",
      name: "Acme Corp",
    });
    expect(mockOrgUpdateWhere).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ stripeCustomerId: "cus_new" }),
      TX
    );
    expect(mockCreateCheckoutSession).toHaveBeenCalledWith(
      expect.objectContaining({
        customerId: "cus_new",
        priceId: "price_pro",
        organizationId: "org-1",
        successUrl: "http://app.test/settings?tab=billing&billing=success",
        cancelUrl: "http://app.test/settings?tab=billing&billing=cancelled",
      })
    );
  });

  it("skips customer creation when the org already has one", async () => {
    await BillingService.createCheckout(
      orgFixture({ stripeCustomerId: "cus_existing" }),
      OWNER,
      "pro"
    );

    expect(mockCreateCustomer).not.toHaveBeenCalled();
    expect(mockOrgUpdateWhere).not.toHaveBeenCalled();
    expect(mockCreateCheckoutSession).toHaveBeenCalledWith(
      expect.objectContaining({ customerId: "cus_existing" })
    );
  });

  // #938: a rename that commits while the customer is being created leaves
  // Stripe with the old name; the row the id write returns shows it.
  it("syncs the Stripe name when the org was renamed during customer creation", async () => {
    mockOrgUpdateWhere.mockResolvedValue([{ name: "Renamed Corp" }]);

    await BillingService.createCheckout(orgFixture(), OWNER, "pro");

    expect(mockCreateCustomer).toHaveBeenCalledWith(
      expect.objectContaining({ name: "Acme Corp" })
    );
    expect(mockUpdateCustomerName).toHaveBeenCalledWith(
      "cus_new",
      "Renamed Corp"
    );
    expect(mockCreateCheckoutSession).toHaveBeenCalled();
  });

  it("still returns the session when the name sync fails", async () => {
    mockOrgUpdateWhere.mockResolvedValue([{ name: "Renamed Corp" }]);
    mockUpdateCustomerName.mockRejectedValue(new Error("stripe down"));

    const result = await BillingService.createCheckout(
      orgFixture(),
      OWNER,
      "pro"
    );

    expect(result).toEqual({ url: "https://checkout.stripe.com/c/session" });
  });

  // #939: the id is stored only while none is; a lost write means another
  // checkout stored its customer first.
  it("a lost customer-id write deletes its own customer and uses the stored one", async () => {
    mockOrgUpdateWhere.mockResolvedValue([]);
    mockOrgFindById
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce({ stripeCustomerId: "cus_winner" });

    await BillingService.createCheckout(orgFixture(), OWNER, "pro");

    expect(mockDeleteCustomer).toHaveBeenCalledWith("cus_new");
    expect(mockUpdateCustomerName).not.toHaveBeenCalled();
    // The winner is an existing customer, so it gets the same checks.
    expect(mockListOpenCheckoutSessions).toHaveBeenCalledWith("cus_winner");
    expect(mockListSubscriptions).toHaveBeenCalledWith("cus_winner");
    expect(mockCreateCheckoutSession).toHaveBeenCalledWith(
      expect.objectContaining({ customerId: "cus_winner" })
    );
  });

  it("doesn't sync the Stripe name when the stored name is the one sent", async () => {
    await BillingService.createCheckout(orgFixture(), OWNER, "pro");

    expect(mockUpdateCustomerName).not.toHaveBeenCalled();
  });

  it("doesn't sync the Stripe name for an existing customer", async () => {
    await BillingService.createCheckout(
      orgFixture({ stripeCustomerId: "cus_existing" }),
      OWNER,
      "pro"
    );

    expect(mockOrgUpdateWhere).not.toHaveBeenCalled();
    expect(mockUpdateCustomerName).not.toHaveBeenCalled();
  });

  // ── #939: Stripe's state, not only the webhook-written column ─────
  it("takes the per-org checkout lock before anything else", async () => {
    await BillingService.createCheckout(orgFixture(), OWNER, "pro");

    expect(mockExecute).toHaveBeenCalledTimes(1);
    expect(mockExecute.mock.invocationCallOrder[0]).toBeLessThan(
      mockCreateCustomer.mock.invocationCallOrder[0]
    );
  });

  it("409 when the re-read row already tracks a subscription", async () => {
    mockOrgFindById.mockResolvedValue(
      orgFixture({ stripeCustomerId: "cus_1", stripeSubscriptionId: "sub_1" })
    );

    await expect(
      BillingService.createCheckout(orgFixture(), OWNER, "pro")
    ).rejects.toMatchObject({
      status: 409,
      code: "BILLING_ALREADY_SUBSCRIBED",
    });
    expect(mockCreateCheckoutSession).not.toHaveBeenCalled();
  });

  it("uses the customer a checkout that held the lock first stored", async () => {
    mockOrgFindById.mockResolvedValue(
      orgFixture({ stripeCustomerId: "cus_first" })
    );

    await BillingService.createCheckout(orgFixture(), OWNER, "pro");

    expect(mockCreateCustomer).not.toHaveBeenCalled();
    expect(mockCreateCheckoutSession).toHaveBeenCalledWith(
      expect.objectContaining({ customerId: "cus_first" })
    );
  });

  it.each(["active", "trialing", "past_due", "incomplete", "unpaid", "paused"])(
    "409 (not 502) when Stripe lists a %s subscription the webhook hasn't recorded",
    async (status) => {
      mockListSubscriptions.mockResolvedValue([{ id: "sub_late", status }]);

      await expect(
        BillingService.createCheckout(
          orgFixture({ stripeCustomerId: "cus_existing" }),
          OWNER,
          "pro"
        )
      ).rejects.toMatchObject({
        status: 409,
        code: "BILLING_ALREADY_SUBSCRIBED",
      });
      expect(mockListSubscriptions).toHaveBeenCalledWith("cus_existing");
      expect(mockCreateCheckoutSession).not.toHaveBeenCalled();
    }
  );

  it("allows checkout when every subscription has ended", async () => {
    mockListSubscriptions.mockResolvedValue([
      { id: "sub_old", status: "canceled" },
      { id: "sub_abandoned", status: "incomplete_expired" },
    ]);

    await expect(
      BillingService.createCheckout(
        orgFixture({ stripeCustomerId: "cus_existing" }),
        OWNER,
        "pro"
      )
    ).resolves.toEqual({ url: "https://checkout.stripe.com/c/session" });
  });

  it("expires the customer's open sessions before creating a new one", async () => {
    mockListOpenCheckoutSessions.mockResolvedValue(["cs_tab1", "cs_tab2"]);

    await BillingService.createCheckout(
      orgFixture({ stripeCustomerId: "cus_existing" }),
      OWNER,
      "pro"
    );

    expect(mockExpireCheckoutSession).toHaveBeenCalledWith("cs_tab1");
    expect(mockExpireCheckoutSession).toHaveBeenCalledWith("cs_tab2");
    // Expired before the subscription check, so no older session can
    // complete after it.
    expect(mockExpireCheckoutSession.mock.invocationCallOrder[1]).toBeLessThan(
      mockListSubscriptions.mock.invocationCallOrder[0]
    );
    expect(mockExpireCheckoutSession.mock.invocationCallOrder[1]).toBeLessThan(
      mockCreateCheckoutSession.mock.invocationCallOrder[0]
    );
  });

  it("409 when an open session was paid before it could be expired", async () => {
    mockListOpenCheckoutSessions.mockResolvedValue(["cs_paying"]);
    mockExpireCheckoutSession.mockResolvedValue(false);

    await expect(
      BillingService.createCheckout(
        orgFixture({ stripeCustomerId: "cus_existing" }),
        OWNER,
        "pro"
      )
    ).rejects.toMatchObject({
      status: 409,
      code: "BILLING_ALREADY_SUBSCRIBED",
    });
    expect(mockCreateCheckoutSession).not.toHaveBeenCalled();
  });

  it("a brand-new customer skips the Stripe subscription and session reads", async () => {
    await BillingService.createCheckout(orgFixture(), OWNER, "pro");

    expect(mockListOpenCheckoutSessions).not.toHaveBeenCalled();
    expect(mockListSubscriptions).not.toHaveBeenCalled();
  });

  it("fails closed: 502 and no session when Stripe can't list subscriptions", async () => {
    mockListSubscriptions.mockRejectedValue(new Error("stripe down"));

    await expect(
      BillingService.createCheckout(
        orgFixture({ stripeCustomerId: "cus_existing" }),
        OWNER,
        "pro"
      )
    ).rejects.toMatchObject({ status: 502, code: "BILLING_CHECKOUT_FAILED" });
    expect(mockCreateCheckoutSession).not.toHaveBeenCalled();
  });

  it("keeps a new customer's id when the session call then fails", async () => {
    mockCreateCheckoutSession.mockRejectedValue(new Error("stripe down"));

    await expect(
      BillingService.createCheckout(orgFixture(), OWNER, "pro")
    ).rejects.toMatchObject({ status: 502, code: "BILLING_CHECKOUT_FAILED" });
    // Returned, not thrown, inside the transaction — so the write commits.
    expect(mockOrgUpdateWhere).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ stripeCustomerId: "cus_new" }),
      TX
    );
  });

  it("502 BILLING_CHECKOUT_FAILED when the Stripe session call fails", async () => {
    mockCreateCheckoutSession.mockRejectedValue(new Error("stripe down"));

    await expect(
      BillingService.createCheckout(
        orgFixture({ stripeCustomerId: "cus_existing" }),
        OWNER,
        "pro"
      )
    ).rejects.toMatchObject({ status: 502, code: "BILLING_CHECKOUT_FAILED" });
  });
});

// ── #939: POST /api/billing/sync ─────────────────────────────────────

describe("BillingService.syncFromStripe", () => {
  const liveSub = (overrides: Record<string, unknown> = {}) => ({
    id: "sub_paid",
    status: "active",
    created: 100,
    billing_cycle_anchor: Date.UTC(2026, 6, 15) / 1000,
    items: { data: [{ price: { id: "price_pro" } }] },
    ...overrides,
  });

  it("503 when unconfigured, 403 without billing.manage", async () => {
    mockIsConfigured.mockReturnValue(false);
    await expect(
      BillingService.syncFromStripe(orgFixture(), OWNER)
    ).rejects.toMatchObject({ status: 503 });
    mockIsConfigured.mockReturnValue(true);
    await expect(
      BillingService.syncFromStripe(orgFixture(), MEMBER)
    ).rejects.toMatchObject({ status: 403, code: "PERMISSION_DENIED" });
  });

  it("no customer → none, without calling Stripe", async () => {
    await expect(
      BillingService.syncFromStripe(orgFixture(), OWNER)
    ).resolves.toEqual({ tier: "standard", subscription: "none" });
    expect(mockListSubscriptions).not.toHaveBeenCalled();
  });

  it("live: a paid subscription the webhook never recorded converges the plan", async () => {
    mockListSubscriptions.mockResolvedValue([liveSub()]);

    const result = await BillingService.syncFromStripe(
      orgFixture({ stripeCustomerId: "cus_1" }),
      OWNER
    );

    expect(result).toEqual({ tier: "pro", subscription: "live" });
    expect(mockOrgFindByIdForUpdate).toHaveBeenCalledWith("org-1", TX);
    // On the transaction's connection, not a second pooled one.
    expect(mockPriceIndex).toHaveBeenCalledWith(TX);
    expect(mockOrgUpdate).toHaveBeenCalledWith(
      "org-1",
      expect.objectContaining({
        tier: "pro",
        stripeSubscriptionId: "sub_paid",
      }),
      TX
    );
    expect(mockInsertIfNew).toHaveBeenCalledWith(
      expect.objectContaining({
        source: "stripe",
        type: "billing.sync",
        externalId: expect.stringMatching(/^sync:/),
        outcome: "applied",
        resultingTier: "pro",
      }),
      TX
    );
  });

  it("an org already converged writes nothing", async () => {
    mockListSubscriptions.mockResolvedValue([liveSub()]);
    mockOrgFindByIdForUpdate.mockResolvedValue(
      orgFixture({
        tier: "pro",
        stripeCustomerId: "cus_1",
        stripeSubscriptionId: "sub_paid",
        billingAnchorDay: 15,
      })
    );

    const result = await BillingService.syncFromStripe(
      orgFixture({ stripeCustomerId: "cus_1" }),
      OWNER
    );

    expect(result).toEqual({ tier: "pro", subscription: "live" });
    expect(mockOrgUpdate).not.toHaveBeenCalled();
    expect(mockInsertIfNew).not.toHaveBeenCalled();
  });

  it("pending: an incomplete subscription grants nothing yet", async () => {
    mockListSubscriptions.mockResolvedValue([
      liveSub({ status: "incomplete" }),
    ]);

    const result = await BillingService.syncFromStripe(
      orgFixture({ stripeCustomerId: "cus_1" }),
      OWNER
    );

    expect(result).toEqual({ tier: "standard", subscription: "pending" });
    expect(mockOrgUpdate).not.toHaveBeenCalled();
  });

  it("none: only ended subscriptions", async () => {
    mockListSubscriptions.mockResolvedValue([liveSub({ status: "canceled" })]);

    await expect(
      BillingService.syncFromStripe(
        orgFixture({ stripeCustomerId: "cus_1" }),
        OWNER
      )
    ).resolves.toEqual({ tier: "standard", subscription: "none" });
  });

  it("a customer with no subscriptions leaves a hand-set plan alone", async () => {
    mockListSubscriptions.mockResolvedValue([]);
    mockOrgFindByIdForUpdate.mockResolvedValue(
      orgFixture({ tier: "enterprise", stripeCustomerId: "cus_1" })
    );

    const result = await BillingService.syncFromStripe(
      orgFixture({ tier: "enterprise", stripeCustomerId: "cus_1" }),
      OWNER
    );

    expect(result).toEqual({ tier: "enterprise", subscription: "none" });
    expect(mockOrgUpdate).not.toHaveBeenCalled();
    expect(mockInsertIfNew).not.toHaveBeenCalled();
  });

  it("502 BILLING_SYNC_FAILED when Stripe can't be read", async () => {
    mockListSubscriptions.mockRejectedValue(new Error("stripe down"));

    await expect(
      BillingService.syncFromStripe(
        orgFixture({ stripeCustomerId: "cus_1" }),
        OWNER
      )
    ).rejects.toMatchObject({ status: 502, code: "BILLING_SYNC_FAILED" });
  });
});

// ── case 17: portal ──────────────────────────────────────────────────

describe("BillingService.createPortal", () => {
  it("503 when unconfigured, 403 for a non-owner", async () => {
    mockIsConfigured.mockReturnValue(false);
    await expect(
      BillingService.createPortal(orgFixture(), OWNER)
    ).rejects.toMatchObject({ status: 503, code: "BILLING_NOT_CONFIGURED" });

    mockIsConfigured.mockReturnValue(true);
    await expect(
      BillingService.createPortal(
        orgFixture({ stripeCustomerId: "cus_1" }),
        MEMBER
      )
    ).rejects.toMatchObject({ status: 403, code: "PERMISSION_DENIED" });
  });

  it("409 BILLING_NO_SUBSCRIPTION without a Stripe customer", async () => {
    await expect(
      BillingService.createPortal(orgFixture(), OWNER)
    ).rejects.toMatchObject({ status: 409, code: "BILLING_NO_SUBSCRIPTION" });
  });

  it("returns the portal URL for a customer-linked org", async () => {
    await expect(
      BillingService.createPortal(
        orgFixture({ stripeCustomerId: "cus_1" }),
        OWNER
      )
    ).resolves.toEqual({ url: "https://billing.stripe.com/p/session" });
    expect(mockCreatePortalSession).toHaveBeenCalledWith({
      customerId: "cus_1",
      returnUrl: "http://app.test/settings",
    });
  });

  it("502 BILLING_PORTAL_FAILED when Stripe fails", async () => {
    mockCreatePortalSession.mockRejectedValue(new Error("stripe down"));

    await expect(
      BillingService.createPortal(
        orgFixture({ stripeCustomerId: "cus_1" }),
        OWNER
      )
    ).rejects.toMatchObject({ status: 502, code: "BILLING_PORTAL_FAILED" });
  });

  // ── #260: switch flow (createPortal with a target tier) ──────────────
  const subbed = () =>
    orgFixture({ stripeCustomerId: "cus_1", stripeSubscriptionId: "sub_1" });

  // case 3: builds the subscription-update descriptor from the resolved price
  it("switch: resolves the price + current item and passes subscriptionUpdate", async () => {
    await expect(
      BillingService.createPortal(subbed(), OWNER, "pro")
    ).resolves.toEqual({ url: "https://billing.stripe.com/p/session" });
    expect(mockFetchSubscription).toHaveBeenCalledWith("sub_1");
    expect(mockCreatePortalSession).toHaveBeenCalledWith({
      customerId: "cus_1",
      returnUrl: "http://app.test/settings",
      subscriptionUpdate: {
        subscriptionId: "sub_1",
        itemId: "si_1",
        priceId: "price_pro",
      },
    });
  });

  // case 4: switching without a live subscription
  it("switch: 409 BILLING_NO_SUBSCRIPTION when the org has no subscription", async () => {
    await expect(
      BillingService.createPortal(
        orgFixture({ stripeCustomerId: "cus_1" }), // no stripeSubscriptionId
        OWNER,
        "pro"
      )
    ).rejects.toMatchObject({ status: 409, code: "BILLING_NO_SUBSCRIPTION" });
    expect(mockCreatePortalSession).not.toHaveBeenCalled();
  });

  // case 5: unknown / unpriced target tier
  it("switch: 404 for an unknown tier, 400 for an unpriced one", async () => {
    await expect(
      BillingService.createPortal(subbed(), OWNER, "nope")
    ).rejects.toMatchObject({ status: 404, code: "BILLING_TIER_NOT_FOUND" });
    await expect(
      BillingService.createPortal(subbed(), OWNER, "standard") // selectable, no price
    ).rejects.toMatchObject({
      status: 400,
      code: "BILLING_TIER_NOT_PURCHASABLE",
    });
  });

  // case 2: no tier → Manage (no subscriptionUpdate key)
  it("no tier → Manage session (no subscriptionUpdate)", async () => {
    await BillingService.createPortal(subbed(), OWNER);
    expect(mockCreatePortalSession).toHaveBeenCalledWith({
      customerId: "cus_1",
      returnUrl: "http://app.test/settings",
    });
    expect(mockFetchSubscription).not.toHaveBeenCalled();
  });
});

// ── plan list mapping ────────────────────────────────────────────────

describe("BillingService.listBillingTiers (#241)", () => {
  // ── case 11: full policy + blurb + cta projection ───────────────────
  it("projects the full policy, blurb, and cta; only the subscribe tier hits Stripe", async () => {
    const tiers = await BillingService.listBillingTiers("org-1");

    // Org-scoped finder is the source (isolation lives in the query).
    expect(mockFindSelectableForOrg).toHaveBeenCalledWith("org-1");

    expect(tiers).toEqual([
      expect.objectContaining({
        slug: "standard",
        cta: "none",
        description: null,
        price: null,
        policy: expect.objectContaining({
          allocations: expect.objectContaining({
            metered: { unitsPerPeriod: 1000, ratePerMin: 20 },
          }),
          entitlements: {
            builtinToolpacks: ["data_query"],
            customToolpacks: true,
          },
          overage: "hard-deny",
          period: { kind: "monthly", anchorDay: 1 },
        }),
      }),
      expect.objectContaining({
        slug: "pro",
        cta: "subscribe",
        description: "Everything in Standard, plus more.",
        price: { unitAmount: 4900, currency: "usd", interval: "month" },
      }),
    ]);
    // Only the priced (subscribe) tier hits Stripe.
    expect(mockGetPrice).toHaveBeenCalledTimes(1);
  });

  // ── case 13: price degrades, cta stays truthful ─────────────────────
  it("null-degrades the price on a Stripe outage without changing cta", async () => {
    mockGetPrice.mockResolvedValue(null);

    const tiers = await BillingService.listBillingTiers("org-1");
    const pro = tiers.find((t) => t.slug === "pro");
    expect(pro).toMatchObject({ cta: "subscribe", price: null });
  });
});
