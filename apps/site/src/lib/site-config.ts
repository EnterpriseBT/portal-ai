/**
 * Build-time site configuration (#311).
 *
 * The public site is fully static: prices, credit allocations, and contact
 * addresses are fetched ONCE per build from `GET /api/public/site-config`
 * and baked into the emitted HTML. Nothing is fetched in the browser, so
 * every page renders with JavaScript disabled and there is no request
 * amplification from crawler traffic.
 *
 * Two modes, and the distinction is the safety property:
 *
 * - **`SITE_CONFIG_URL` set (every deploy).** Any failure — transport,
 *   non-200, schema mismatch — THROWS and fails the build. A published page
 *   is a durable artifact: shipping "Pro — let's talk" because Stripe
 *   blipped is worse than not shipping. Fail loudly, keep the last good
 *   deploy live.
 * - **`SITE_CONFIG_URL` unset (local dev, root `npm run build`).** Falls
 *   back to a committed, schema-valid fixture so the repo builds offline
 *   with no API running. Fixture builds stamp `fixture` into the page's
 *   `portal:build` meta tag, and the deploy workflow greps for that stamp
 *   and fails — belt and braces, so a fixture build can never be published.
 */

import {
  PublicSiteConfigResponseSchema,
  type PublicSiteConfigResponse,
} from "@portalai/core/contracts";

import fixture from "./site-config.fixture.json" with { type: "json" };

export interface SiteConfigResult {
  config: PublicSiteConfigResponse;
  /** true ⇒ the fixture was used; the build must never be published. */
  isFixture: boolean;
}

/** Parse or throw with a message that names the endpoint — a build log is
 *  the only place anyone will see this. */
function parseOrThrow(
  payload: unknown,
  source: string
): PublicSiteConfigResponse {
  const parsed = PublicSiteConfigResponseSchema.safeParse(payload);
  if (!parsed.success) {
    throw new Error(
      `Site config from ${source} did not match PublicSiteConfigResponseSchema: ` +
        JSON.stringify(parsed.error.issues)
    );
  }
  return parsed.data;
}

/**
 * Fetch the snapshot once. Callers thread the SAME object to every page so
 * two pages can never disagree about a price.
 *
 * @param url overrides `SITE_CONFIG_URL` (tests)
 * @param fetchImpl injectable transport (tests)
 */
export async function fetchSiteConfig(
  url: string | undefined = process.env.SITE_CONFIG_URL,
  fetchImpl: typeof fetch = fetch
): Promise<SiteConfigResult> {
  if (!url) {
    // Offline/fixture mode — validated against the same schema so the
    // fixture can never drift from the contract it stands in for.
    return {
      config: parseOrThrow(fixture, "the committed fixture"),
      isFixture: true,
    };
  }

  const response = await fetchImpl(url, {
    headers: { Accept: "application/json" },
  });
  if (!response.ok) {
    throw new Error(
      `Site config fetch failed: ${url} returned ${response.status}. ` +
        "Refusing to publish a site built without live configuration."
    );
  }

  const body = (await response.json()) as { payload?: unknown };
  // The API wraps payloads as `{ success, payload }`.
  return { config: parseOrThrow(body?.payload, url), isFixture: false };
}

/** Tiers in pricing-card order. The endpoint already sorts, but the page
 *  must not depend on that — ordering is a presentation concern here. */
export function orderedTiers(
  config: PublicSiteConfigResponse
): PublicSiteConfigResponse["tiers"] {
  return [...config.tiers].sort((a, b) => a.displayOrder - b.displayOrder);
}

/** `2900, "usd"` → `"$29"` (whole) or `"$29.50"`. Marketing pages show the
 *  cents only when they are non-zero. */
export function formatPrice(unitAmount: number, currency: string): string {
  const major = unitAmount / 100;
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: currency.toUpperCase(),
    minimumFractionDigits: Number.isInteger(major) ? 0 : 2,
    maximumFractionDigits: 2,
  }).format(major);
}
