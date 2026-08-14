/**
 * SiteConfigService (#311 slice 3) — assembles the public site-config
 * snapshot. The heart of the suite is the SPLIT price rule (discovery D4):
 * a null stripePriceId is a legitimate amountless tier (contact card); a
 * non-null stripePriceId whose price will not resolve is an ERROR (503) —
 * so a Stripe outage fails the site build instead of silently publishing
 * "Pro" as a contact-us card.
 */

import { jest, it, expect, beforeEach } from "@jest/globals";

// ── Mocks ────────────────────────────────────────────────────────────

const mockFindPublic = jest.fn<() => Promise<Record<string, unknown>[]>>();
jest.unstable_mockModule("../../services/db.service.js", () => ({
  DbService: {
    repository: {
      tiers: { findPublic: mockFindPublic },
    },
  },
}));

const mockGetPrice = jest.fn<
  (priceId: string) => Promise<{
    unitAmount: number;
    currency: string;
    interval: "month" | "year";
  } | null>
>();
jest.unstable_mockModule("../../services/stripe.service.js", () => ({
  StripeService: { getPrice: mockGetPrice },
}));

const { SiteConfigService } =
  await import("../../services/site-config.service.js");
const { ApiError } = await import("../../services/http.service.js");
const { ApiCode } = await import("../../constants/api-codes.constants.js");

// ── Fixtures ─────────────────────────────────────────────────────────

const publicRow = (over: Record<string, unknown> = {}) => ({
  id: "t1",
  slug: "standard",
  displayName: "Standard",
  description: null,
  cta: "none",
  public: true,
  displayOrder: 1,
  meteredUnitsPerPeriod: 500,
  expensiveUnitsPerPeriod: 20,
  builtinToolpacks: ["data_query", "web_search"],
  customToolpacks: false,
  stripePriceId: null,
  visibleToOrganizationId: null,
  ...over,
});

const PRICE = { unitAmount: 4900, currency: "usd", interval: "month" as const };

beforeEach(() => {
  SiteConfigService.clearCache();
  mockFindPublic.mockReset();
  mockGetPrice.mockReset();
});

// ── case 1 — the happy snapshot ──────────────────────────────────────

it("assembles { tiers, generatedAt } from public rows", async () => {
  mockFindPublic.mockResolvedValue([
    publicRow(),
    publicRow({
      id: "t2",
      slug: "pro",
      displayName: "Pro",
      cta: "subscribe",
      displayOrder: 3,
      meteredUnitsPerPeriod: null,
      expensiveUnitsPerPeriod: 1_000_000,
      customToolpacks: true,
      stripePriceId: "price_pro",
      description: "For teams.",
    }),
  ]);
  mockGetPrice.mockResolvedValue(PRICE);

  const snapshot = await SiteConfigService.getSiteConfig();

  expect(typeof snapshot.generatedAt).toBe("string");
  expect(snapshot.tiers).toHaveLength(2);
  const pro = snapshot.tiers[1];
  expect(pro).toEqual({
    slug: "pro",
    displayName: "Pro",
    description: "For teams.",
    cta: "subscribe",
    displayOrder: 3,
    credits: { metered: null, expensive: 1_000_000 },
    builtinToolpacks: ["data_query", "web_search"],
    customToolpacks: true,
    price: PRICE,
  });
});

// ── case 2 — null stripePriceId is a LEGITIMATE amountless tier ──────

it("a null stripePriceId serves price: null (contact card) without touching Stripe", async () => {
  mockFindPublic.mockResolvedValue([
    publicRow({ slug: "enterprise", cta: "contact" }),
  ]);

  const snapshot = await SiteConfigService.getSiteConfig();
  expect(snapshot.tiers[0].price).toBeNull();
  expect(mockGetPrice).not.toHaveBeenCalled();
});

// ── case 3 — a resolvable price is mapped through getPrice ───────────

it("resolves a non-null stripePriceId via StripeService.getPrice", async () => {
  mockFindPublic.mockResolvedValue([
    publicRow({ slug: "plus", cta: "subscribe", stripePriceId: "price_plus" }),
  ]);
  mockGetPrice.mockResolvedValue(PRICE);

  const snapshot = await SiteConfigService.getSiteConfig();
  expect(mockGetPrice).toHaveBeenCalledWith("price_plus");
  expect(snapshot.tiers[0].price).toEqual(PRICE);
});

// ── case 4 — the split rule: unresolvable non-null price is a 503 ────

it("throws 503 SITE_CONFIG_PRICE_UNRESOLVED when a priced tier will not resolve", async () => {
  mockFindPublic.mockResolvedValue([
    publicRow({ slug: "pro", cta: "subscribe", stripePriceId: "price_gone" }),
  ]);
  mockGetPrice.mockResolvedValue(null); // outage OR deleted price — same rule

  const err = await SiteConfigService.getSiteConfig().catch((e) => e);
  expect(err).toBeInstanceOf(ApiError);
  expect(err.status).toBe(503);
  expect(err.code).toBe(ApiCode.SITE_CONFIG_PRICE_UNRESOLVED);
});

// ── case 5 — the TTL cache bounds repo/Stripe load ───────────────────

it("caches the snapshot — a second call re-reads nothing", async () => {
  mockFindPublic.mockResolvedValue([publicRow()]);

  const first = await SiteConfigService.getSiteConfig();
  const second = await SiteConfigService.getSiteConfig();
  expect(second).toBe(first);
  expect(mockFindPublic).toHaveBeenCalledTimes(1);
});

// ── case 6 — errors are never cached ─────────────────────────────────

it("does not cache a failure — the next call retries", async () => {
  mockFindPublic.mockResolvedValue([
    publicRow({ slug: "pro", stripePriceId: "price_x", cta: "subscribe" }),
  ]);
  mockGetPrice.mockResolvedValueOnce(null).mockResolvedValue(PRICE);

  await expect(SiteConfigService.getSiteConfig()).rejects.toBeInstanceOf(
    ApiError
  );
  // Stripe recovered — the retry succeeds instead of serving a cached error.
  const snapshot = await SiteConfigService.getSiteConfig();
  expect(snapshot.tiers[0].price).toEqual(PRICE);
});

// ── contact addresses left this service (#369) ───────────────────────
//
// The fail-closed contact rule that lived here is gone with the field: the
// site reads addresses from its build environment now, so there is nothing
// for this service to resolve or refuse. The PRICE rule above is untouched —
// that is the one that still keeps a Stripe outage from being published as a
// pricing change.

it("serves no contact block", async () => {
  mockFindPublic.mockResolvedValue([publicRow()]);

  const snapshot = await SiteConfigService.getSiteConfig();

  expect((snapshot as { contact?: unknown }).contact).toBeUndefined();
});
