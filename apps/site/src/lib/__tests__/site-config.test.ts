/**
 * Build-time config fetch (#311 slice 6).
 *
 * The load-bearing assertion is the FAIL-LOUD one: when `SITE_CONFIG_URL` is
 * set, every failure path must throw. A published static page outlives the
 * outage that produced it, so a build that quietly degrades to "no price
 * available" is worse than a build that doesn't happen.
 */

import { jest, describe, it, expect } from "@jest/globals";

import { fetchSiteConfig, orderedTiers, formatPrice } from "../site-config.js";

// ── Fixtures ─────────────────────────────────────────────────────────

const URL_ = "https://api-dev.portalsai.io/api/public/site-config";

const tier = (over: Record<string, unknown> = {}) => ({
  slug: "pro",
  displayName: "Pro",
  description: null,
  cta: "subscribe",
  displayOrder: 2,
  credits: { metered: 5000, expensive: 200 },
  builtinToolpacks: ["data_query"],
  customToolpacks: false,
  price: { unitAmount: 2900, currency: "usd", interval: "month" },
  ...over,
});

const payload = (over: Record<string, unknown> = {}) => ({
  tiers: [tier()],
  generatedAt: "2026-08-03T00:00:00.000Z",
  ...over,
});

const jsonResponse = (body: unknown, status = 200) =>
  ({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  }) as Response;

// ── case 1 — a valid live payload parses ─────────────────────────────

describe("fetchSiteConfig", () => {
  it("unwraps and validates a live payload", async () => {
    const fetchImpl = jest
      .fn<typeof fetch>()
      .mockResolvedValue(jsonResponse({ success: true, payload: payload() }));

    const { config, isFixture } = await fetchSiteConfig(URL_, fetchImpl);

    expect(isFixture).toBe(false);
    expect(config.tiers[0].price).toEqual({
      unitAmount: 2900,
      currency: "usd",
      interval: "month",
    });
    expect(fetchImpl).toHaveBeenCalledWith(URL_, {
      headers: { Accept: "application/json" },
    });
  });

  // ── case 2 — a non-200 fails the build ─────────────────────────────

  it("throws on a non-200, naming the endpoint", async () => {
    const fetchImpl = jest
      .fn<typeof fetch>()
      .mockResolvedValue(jsonResponse({}, 503));

    await expect(fetchSiteConfig(URL_, fetchImpl)).rejects.toThrow(/503/);
  });

  // ── case 3 — a shape mismatch fails the build ──────────────────────

  it("throws when the payload does not match the contract", async () => {
    const fetchImpl = jest.fn<typeof fetch>().mockResolvedValue(
      jsonResponse({
        success: true,
        // `credits` missing — exactly the drift a silent build would ship.
        payload: payload({ tiers: [{ ...tier(), credits: undefined }] }),
      })
    );

    await expect(fetchSiteConfig(URL_, fetchImpl)).rejects.toThrow(
      /PublicSiteConfigResponseSchema/
    );
  });

  it("propagates a transport rejection rather than degrading", async () => {
    const fetchImpl = jest
      .fn<typeof fetch>()
      .mockRejectedValue(new Error("ECONNREFUSED"));

    await expect(fetchSiteConfig(URL_, fetchImpl)).rejects.toThrow(
      /ECONNREFUSED/
    );
  });

  // ── case 4 — unset URL falls back to the committed fixture ─────────

  it("uses the schema-valid fixture when no URL is configured", async () => {
    const fetchImpl = jest.fn<typeof fetch>();

    const { config, isFixture } = await fetchSiteConfig(undefined, fetchImpl);

    expect(isFixture).toBe(true);
    expect(fetchImpl).not.toHaveBeenCalled();
    // Offline builds still need something to render.
    expect(config.tiers.length).toBeGreaterThan(0);
    expect(config.generatedAt).toBeTruthy();
  });
});

// ── helpers ──────────────────────────────────────────────────────────

describe("orderedTiers", () => {
  it("sorts by displayOrder without mutating the snapshot", () => {
    const config = {
      ...payload(),
      tiers: [
        tier({ slug: "c", displayOrder: 3 }),
        tier({ slug: "a", displayOrder: 1 }),
        tier({ slug: "b", displayOrder: 2 }),
      ],
    } as never as Parameters<typeof orderedTiers>[0];

    expect(orderedTiers(config).map((t) => t.slug)).toEqual(["a", "b", "c"]);
    expect(config.tiers.map((t) => t.slug)).toEqual(["c", "a", "b"]);
  });
});

describe("formatPrice", () => {
  it("drops cents when the amount is whole", () => {
    expect(formatPrice(2900, "usd")).toBe("$29");
  });

  it("keeps cents when they are non-zero", () => {
    expect(formatPrice(2950, "usd")).toBe("$29.50");
  });

  it("honours the currency from the snapshot", () => {
    expect(formatPrice(2900, "eur")).toContain("29");
  });
});
