/**
 * Unit tests for `StripeService` (#176 slice 2) — the SDK wrapper and the
 * only file importing `stripe`. The SDK is fully mocked
 * (`jest.unstable_mockModule`); CI never needs keys.
 */

import { jest, describe, it, expect, beforeEach } from "@jest/globals";

// ── Mocks ────────────────────────────────────────────────────────────

const mockPricesRetrieve = jest.fn<(id: string) => Promise<unknown>>();
const mockConstructEvent =
  jest.fn<(body: unknown, sig: string, secret: string) => unknown>();
const mockSubscriptionsRetrieve = jest.fn<(id: string) => Promise<unknown>>();
const mockSubscriptionsCancel = jest.fn<(id: string) => Promise<unknown>>();
const mockCustomersCreate = jest.fn<(args: unknown) => Promise<unknown>>();
const mockCheckoutSessionsCreate =
  jest.fn<(args: unknown) => Promise<unknown>>();
const mockPortalSessionsCreate = jest.fn<(args: unknown) => Promise<unknown>>();

const mockStripeConstructor = jest.fn().mockImplementation(() => ({
  prices: { retrieve: mockPricesRetrieve },
  webhooks: { constructEvent: mockConstructEvent },
  subscriptions: {
    retrieve: mockSubscriptionsRetrieve,
    cancel: mockSubscriptionsCancel,
  },
  customers: { create: mockCustomersCreate },
  checkout: { sessions: { create: mockCheckoutSessionsCreate } },
  billingPortal: { sessions: { create: mockPortalSessionsCreate } },
}));

jest.unstable_mockModule("stripe", () => ({
  default: mockStripeConstructor,
}));

// Mutable env stub — individual tests flip keys off. The logger fields keep
// `logger.util.ts` (a transitive import) bootable.
const env: Record<string, string | boolean | undefined> = {
  NODE_ENV: "test",
  LOG_LEVEL: "silent",
  LOG_FORMAT: "json",
  STRIPE_SECRET_KEY: "sk_test_123",
  STRIPE_WEBHOOK_SECRET: "whsec_test_123",
  STRIPE_AUTOMATIC_TAX: true, // #217 default-on
};
jest.unstable_mockModule("../../environment.js", () => ({
  environment: env,
}));

const { StripeService } = await import("../../services/stripe.service.js");

beforeEach(() => {
  mockStripeConstructor.mockClear(); // keep the implementation, drop call history
  mockPricesRetrieve.mockReset();
  mockConstructEvent.mockReset();
  mockSubscriptionsRetrieve.mockReset();
  mockSubscriptionsCancel.mockReset();
  mockCustomersCreate.mockReset();
  mockCheckoutSessionsCreate.mockReset();
  mockPortalSessionsCreate.mockReset();
  env.STRIPE_SECRET_KEY = "sk_test_123";
  env.STRIPE_WEBHOOK_SECRET = "whsec_test_123";
  env.STRIPE_AUTOMATIC_TAX = true; // #217 default-on
  StripeService.resetForTests();
});

// ── isConfigured ─────────────────────────────────────────────────────

describe("StripeService.isConfigured", () => {
  it("is true only when both keys are present", () => {
    expect(StripeService.isConfigured()).toBe(true);

    env.STRIPE_WEBHOOK_SECRET = undefined;
    expect(StripeService.isConfigured()).toBe(false);

    env.STRIPE_WEBHOOK_SECRET = "whsec_test_123";
    env.STRIPE_SECRET_KEY = undefined;
    expect(StripeService.isConfigured()).toBe(false);
  });
});

// ── constructEvent ───────────────────────────────────────────────────

describe("StripeService.constructEvent", () => {
  it("returns the verified event and hands the SDK the exact raw bytes", () => {
    const event = { id: "evt_1", type: "customer.subscription.updated" };
    mockConstructEvent.mockReturnValue(event);

    const raw = Buffer.from('{"id":"evt_1"}');
    const result = StripeService.constructEvent(raw, "sig_header");

    expect(result).toBe(event);
    expect(mockConstructEvent).toHaveBeenCalledWith(
      raw,
      "sig_header",
      "whsec_test_123"
    );
  });

  it("maps a verification failure to ApiError 400 WEBHOOK_INVALID_SIGNATURE (fail-closed)", () => {
    mockConstructEvent.mockImplementation(() => {
      throw new Error("No signatures found matching the expected signature");
    });

    expect(() =>
      StripeService.constructEvent(Buffer.from("{}"), "bad_sig")
    ).toThrow(
      expect.objectContaining({
        status: 400,
        code: "WEBHOOK_INVALID_SIGNATURE",
      })
    );
  });
});

// ── getPrice (case 13) ───────────────────────────────────────────────

describe("StripeService.getPrice", () => {
  const stripePrice = {
    id: "price_pro",
    unit_amount: 4900,
    currency: "usd",
    recurring: { interval: "month" },
  };

  it("maps the Stripe price to the contract shape", async () => {
    mockPricesRetrieve.mockResolvedValue(stripePrice);

    await expect(StripeService.getPrice("price_pro", 1000)).resolves.toEqual({
      unitAmount: 4900,
      currency: "usd",
      interval: "month",
    });
  });

  it("caches within the TTL — one SDK call for two reads", async () => {
    mockPricesRetrieve.mockResolvedValue(stripePrice);

    await StripeService.getPrice("price_pro", 1000);
    await StripeService.getPrice("price_pro", 30_000);

    expect(mockPricesRetrieve).toHaveBeenCalledTimes(1);
  });

  it("re-fetches after the TTL expires", async () => {
    mockPricesRetrieve.mockResolvedValue(stripePrice);

    await StripeService.getPrice("price_pro", 1000);
    await StripeService.getPrice("price_pro", 62_000);

    expect(mockPricesRetrieve).toHaveBeenCalledTimes(2);
  });

  it("returns null (never throws) on an SDK failure — display degradation only", async () => {
    mockPricesRetrieve.mockRejectedValue(new Error("stripe down"));

    await expect(StripeService.getPrice("price_pro", 1000)).resolves.toBeNull();
  });

  it("returns null for a non-recurring or amount-less price", async () => {
    mockPricesRetrieve.mockResolvedValue({
      id: "price_oneoff",
      unit_amount: null,
      currency: "usd",
      recurring: null,
    });

    await expect(
      StripeService.getPrice("price_oneoff", 1000)
    ).resolves.toBeNull();
  });

  it("does not cache a failure (next read retries)", async () => {
    mockPricesRetrieve.mockRejectedValueOnce(new Error("stripe down"));
    mockPricesRetrieve.mockResolvedValue(stripePrice);

    await expect(StripeService.getPrice("price_pro", 1000)).resolves.toBeNull();
    await expect(StripeService.getPrice("price_pro", 2000)).resolves.toEqual({
      unitAmount: 4900,
      currency: "usd",
      interval: "month",
    });
  });
});

// ── client plumbing ──────────────────────────────────────────────────

describe("StripeService client + API passthroughs", () => {
  it("lazily constructs a single client with the secret key and pinned apiVersion", async () => {
    mockPricesRetrieve.mockResolvedValue({
      unit_amount: 1,
      currency: "usd",
      recurring: { interval: "month" },
    });

    expect(mockStripeConstructor).not.toHaveBeenCalled();
    await StripeService.getPrice("price_a", 1000);
    await StripeService.getPrice("price_b", 1000);

    expect(mockStripeConstructor).toHaveBeenCalledTimes(1);
    expect(mockStripeConstructor).toHaveBeenCalledWith(
      "sk_test_123",
      expect.objectContaining({ apiVersion: expect.any(String) })
    );
  });

  it("createCustomer stamps metadata.organizationId for reconciliation", async () => {
    mockCustomersCreate.mockResolvedValue({ id: "cus_new" });

    await expect(
      StripeService.createCustomer({ organizationId: "org-1", name: "Acme" })
    ).resolves.toEqual({ id: "cus_new" });
    expect(mockCustomersCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "Acme",
        metadata: { organizationId: "org-1" },
      })
    );
  });

  it("cancelSubscription cancels immediately by id", async () => {
    mockSubscriptionsCancel.mockResolvedValue({});
    await StripeService.cancelSubscription("sub_1");
    expect(mockSubscriptionsCancel).toHaveBeenCalledWith("sub_1");
  });

  it("fetchSubscription retrieves by id (the converge read)", async () => {
    const subscription = { id: "sub_1", status: "active" };
    mockSubscriptionsRetrieve.mockResolvedValue(subscription);

    await expect(StripeService.fetchSubscription("sub_1")).resolves.toBe(
      subscription
    );
  });
});

// ── createCheckoutSession tax params (#217) ──────────────────────────

describe("StripeService.createCheckoutSession — Stripe Tax (#217)", () => {
  const args = {
    customerId: "cus_1",
    priceId: "price_1",
    successUrl: "https://app/settings?billing=success",
    cancelUrl: "https://app/settings?billing=cancelled",
    organizationId: "org-1",
  };

  it("flag on (default): session carries automatic_tax + address collection", async () => {
    mockCheckoutSessionsCreate.mockResolvedValue({ url: "https://stripe/x" });

    await StripeService.createCheckoutSession(args);

    expect(mockCheckoutSessionsCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        // pre-existing params unchanged
        mode: "subscription",
        customer: "cus_1",
        line_items: [{ price: "price_1", quantity: 1 }],
        metadata: { organizationId: "org-1" },
        // #217 tax params
        automatic_tax: { enabled: true },
        billing_address_collection: "required",
        customer_update: { address: "auto" },
      })
    );
  });

  it("STRIPE_AUTOMATIC_TAX=false: session is byte-compatible with the pre-#217 shape", async () => {
    env.STRIPE_AUTOMATIC_TAX = false;
    mockCheckoutSessionsCreate.mockResolvedValue({ url: "https://stripe/x" });

    await StripeService.createCheckoutSession(args);

    const params = mockCheckoutSessionsCreate.mock.calls[0][0] as Record<
      string,
      unknown
    >;
    expect(params).not.toHaveProperty("automatic_tax");
    expect(params).not.toHaveProperty("billing_address_collection");
    expect(params).not.toHaveProperty("customer_update");
    expect(params).toMatchObject({
      mode: "subscription",
      customer: "cus_1",
      line_items: [{ price: "price_1", quantity: 1 }],
    });
  });
});
