/**
 * Unit tests for `BillingService` checkout/portal logic (#176 slice 4,
 * cases 15–17) — the guard ladder in spec order, lazy customer creation,
 * and the portal guards. Stripe SDK + repositories mocked.
 */

import { jest, describe, it, expect, beforeEach } from "@jest/globals";

// ── Mocks ────────────────────────────────────────────────────────────

const mockIsConfigured = jest.fn<() => boolean>();
const mockCreateCustomer =
  jest.fn<(args: unknown) => Promise<{ id: string }>>();
const mockCreateCheckoutSession =
  jest.fn<(args: unknown) => Promise<{ url: string }>>();
const mockCreatePortalSession =
  jest.fn<(args: unknown) => Promise<{ url: string }>>();
const mockGetPrice = jest.fn<(id: string) => Promise<unknown>>();

jest.unstable_mockModule("../../services/stripe.service.js", () => ({
  StripeService: {
    isConfigured: mockIsConfigured,
    createCustomer: mockCreateCustomer,
    createCheckoutSession: mockCreateCheckoutSession,
    createPortalSession: mockCreatePortalSession,
    getPrice: mockGetPrice,
    fetchSubscription: jest.fn(),
  },
}));

const mockFindBySlug =
  jest.fn<(slug: string) => Promise<Record<string, unknown> | undefined>>();
const mockFindSelectableForOrg =
  jest.fn<(orgId: string) => Promise<Record<string, unknown>[]>>();
const mockOrgUpdate =
  jest.fn<(...args: unknown[]) => Promise<Record<string, unknown>>>();

jest.unstable_mockModule("../../services/db.service.js", () => ({
  DbService: {
    repository: {
      organizations: { update: mockOrgUpdate },
      tiers: {
        findBySlug: mockFindBySlug,
        findSelectableForOrg: mockFindSelectableForOrg,
      },
    },
    transaction: (fn: (tx: unknown) => Promise<unknown>) => fn({}),
  },
}));

// Env stub controls the settings-URL base; logger + namespace fields keep
// transitive imports bootable.
jest.unstable_mockModule("../../environment.js", () => ({
  environment: {
    NODE_ENV: "test",
    LOG_LEVEL: "silent",
    LOG_FORMAT: "json",
    NAMESPACE: "6ba7b810-9dad-11d1-80b4-00c04fd430c8",
    CORS_ORIGIN: ["http://app.test"],
  },
}));

const { BillingService } = await import("../../services/billing.service.js");

// ── Fixtures ─────────────────────────────────────────────────────────

const OWNER = "user-owner";
const MEMBER = "user-member";

function orgFixture(overrides: Record<string, unknown> = {}) {
  return {
    id: "org-1",
    name: "Acme Corp",
    ownerUserId: OWNER,
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
  mockOrgUpdate.mockReset().mockResolvedValue({});
});

// ── case 15: checkout guard ladder, in spec order ────────────────────

describe("BillingService.createCheckout guards", () => {
  it("503 BILLING_NOT_CONFIGURED first — even for a non-owner", async () => {
    mockIsConfigured.mockReturnValue(false);

    await expect(
      BillingService.createCheckout(orgFixture(), MEMBER, "pro")
    ).rejects.toMatchObject({ status: 503, code: "BILLING_NOT_CONFIGURED" });
  });

  it("403 BILLING_NOT_OWNER before the subscribed check", async () => {
    await expect(
      BillingService.createCheckout(
        orgFixture({ stripeSubscriptionId: "sub_1" }),
        MEMBER,
        "pro"
      )
    ).rejects.toMatchObject({ status: 403, code: "BILLING_NOT_OWNER" });
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
    expect(mockOrgUpdate).toHaveBeenCalledWith(
      "org-1",
      expect.objectContaining({ stripeCustomerId: "cus_new" })
    );
    expect(mockCreateCheckoutSession).toHaveBeenCalledWith(
      expect.objectContaining({
        customerId: "cus_new",
        priceId: "price_pro",
        organizationId: "org-1",
        successUrl: "http://app.test/settings?billing=success",
        cancelUrl: "http://app.test/settings?billing=cancelled",
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
    expect(mockOrgUpdate).not.toHaveBeenCalled();
    expect(mockCreateCheckoutSession).toHaveBeenCalledWith(
      expect.objectContaining({ customerId: "cus_existing" })
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
    ).rejects.toMatchObject({ status: 403, code: "BILLING_NOT_OWNER" });
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
