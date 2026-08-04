/**
 * SiteConfigService (#311) — assembles the public site-config snapshot
 * served by `GET /api/public/site-config` and baked into the marketing
 * site's static HTML at build time.
 *
 * The snapshot is a PRESENTATION projection of the public tier rows
 * (`tiersRepo.findPublic`) — never a serialized `TierPolicy` (see
 * `site-config.contract.ts`). Amounts resolve from the persisted
 * `stripePriceId` via `StripeService.getPrice`, with the SPLIT rule
 * (discovery D4):
 *
 * - `stripePriceId === null` → a legitimately amountless tier; served with
 *   `price: null` (the bespoke "contact us" card).
 * - `stripePriceId` set but unresolvable → **503
 *   `SITE_CONFIG_PRICE_UNRESOLVED`** (fail closed). A Stripe outage must
 *   fail the site build, not silently republish "Pro — $X/mo" as
 *   "Pro — let's talk".
 *
 * In-process TTL snapshot cache (`priceCache` shape): bounds DB/Stripe/SSM
 * load regardless of anonymous request rate. Errors are never cached.
 */

import type { PublicSiteConfigResponse } from "@portalai/core/contracts";
import { TierCtaSchema } from "@portalai/core/models";

import { DbService } from "./db.service.js";
import { StripeService } from "./stripe.service.js";
import { BusinessConfigService } from "./business-config.service.js";
import { ApiError } from "./http.service.js";
import { ApiCode } from "../constants/api-codes.constants.js";
import { createLogger } from "../utils/logger.util.js";

const logger = createLogger({ module: "site-config-service" });

/** 60 s — matches PRICE_CACHE_TTL_MS's posture; staleness of the published
 *  site is bounded by rebuild cadence, not by this. */
const SITE_CONFIG_CACHE_TTL_MS = 60_000;

interface SnapshotCacheEntry {
  snapshot: PublicSiteConfigResponse;
  expires: number;
}

export class SiteConfigService {
  private static cache: SnapshotCacheEntry | null = null;

  /**
   * The atomic snapshot: `{ tiers, contact, generatedAt }`. Throws
   * `ApiError(503, SITE_CONFIG_PRICE_UNRESOLVED)` per the split rule;
   * every other upstream degradation is handled below this layer
   * (BusinessConfigService fails soft; findPublic errors bubble as 500).
   */
  static async getSiteConfig(): Promise<PublicSiteConfigResponse> {
    const now = Date.now();
    const cached = SiteConfigService.cache;
    if (cached && cached.expires > now) {
      return cached.snapshot;
    }

    const [rows, contact] = await Promise.all([
      DbService.repository.tiers.findPublic(),
      BusinessConfigService.getContact(),
    ]);

    // Fail closed on a missing address, symmetrical with the price rule
    // below. `BusinessConfigService` degrades SSM → env → `""`, and an empty
    // string is indistinguishable from "no support channel" once it is a
    // `mailto:` href baked into every published page. Refuse to serve it.
    const missingContact = (["supportEmail", "salesEmail"] as const).filter(
      (field) => !contact[field]?.trim()
    );
    if (missingContact.length > 0) {
      logger.error(
        { missingContact },
        "Public contact address unresolved; failing closed"
      );
      throw new ApiError(
        503,
        ApiCode.SITE_CONFIG_CONTACT_UNRESOLVED,
        `Contact address(es) not configured: ${missingContact.join(", ")}. ` +
          "Set them via `portalops vars set` (or SUPPORT_EMAIL/SALES_EMAIL locally)."
      );
    }

    const tiers = await Promise.all(
      rows.map(async (row) => {
        let price = null;
        if (row.stripePriceId) {
          price = await StripeService.getPrice(row.stripePriceId);
          if (!price) {
            // Split rule: "has a price id but it won't resolve" is an
            // outage/misconfiguration, NOT an amountless tier.
            logger.error(
              { slug: row.slug, stripePriceId: row.stripePriceId },
              "Public tier price unresolvable; failing closed"
            );
            throw new ApiError(
              503,
              ApiCode.SITE_CONFIG_PRICE_UNRESOLVED,
              `Price for public tier '${row.slug}' could not be resolved`
            );
          }
        }
        return {
          slug: row.slug,
          displayName: row.displayName,
          description: row.description,
          cta: TierCtaSchema.parse(row.cta),
          displayOrder: row.displayOrder,
          credits: {
            metered: row.meteredUnitsPerPeriod,
            expensive: row.expensiveUnitsPerPeriod,
          },
          builtinToolpacks: row.builtinToolpacks,
          customToolpacks: row.customToolpacks,
          price,
        };
      })
    );

    const snapshot: PublicSiteConfigResponse = {
      tiers,
      contact,
      generatedAt: new Date(now).toISOString(),
    };
    SiteConfigService.cache = {
      snapshot,
      expires: now + SITE_CONFIG_CACHE_TTL_MS,
    };
    return snapshot;
  }

  /** Test seam. */
  static clearCache(): void {
    SiteConfigService.cache = null;
  }
}
