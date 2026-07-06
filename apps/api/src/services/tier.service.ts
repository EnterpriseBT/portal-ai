/**
 * TierService — resolves an organization's subscription tier into a
 * {@link TierPolicy} (#172).
 *
 * Definitions live in the DB (`tiers` table), so `resolveTier` is a read.
 * The cost gate (#169) will call it on every tool call, so it is backed by a
 * short in-process TTL cache. An unknown/blank slug falls back to the default
 * tier and never throws — it runs inside the gate prelude on the hot path.
 */

import { DbService } from "./db.service.js";
import { ApiError } from "./http.service.js";
import { ApiCode } from "../constants/api-codes.constants.js";
import { createLogger } from "../utils/logger.util.js";
import type { TierPolicy } from "@portalai/core/models";
import type { TierSelect } from "../db/schema/zod.js";

const logger = createLogger({ module: "tier-service" });

const CACHE_TTL_MS = 60_000;

interface CacheEntry {
  policy: TierPolicy;
  expires: number;
}

export class TierService {
  static readonly DEFAULT_TIER = "standard";
  private static cache = new Map<string, CacheEntry>();

  /** Assemble the nested {@link TierPolicy} from a flat `tiers` row. */
  static tierPolicyFromRow(row: TierSelect): TierPolicy {
    return {
      tier: row.slug,
      period: { kind: "monthly", anchorDay: row.periodAnchorDay },
      allocations: {
        free: {
          unitsPerPeriod: row.freeUnitsPerPeriod,
          ratePerMin: row.freeRatePerMin,
        },
        metered: {
          unitsPerPeriod: row.meteredUnitsPerPeriod,
          ratePerMin: row.meteredRatePerMin,
        },
        expensive: {
          unitsPerPeriod: row.expensiveUnitsPerPeriod,
          ratePerMin: row.expensiveRatePerMin,
        },
      },
      perToolCaps: row.perToolCaps ?? null,
      // CHECK-constrained at the DB to the valid set.
      overage: row.overage as TierPolicy["overage"],
    };
  }

  /**
   * Resolve an org's tier policy. Cached for {@link CACHE_TTL_MS}. Unknown or
   * blank slug → the default tier, logged, never thrown. Only throws if even
   * the default tier is unseeded (a 500-class invariant violation).
   */
  static async resolveTier(
    org: { tier: string },
    now: number = Date.now()
  ): Promise<TierPolicy> {
    const slug = org.tier || TierService.DEFAULT_TIER;

    const hit = TierService.cache.get(slug);
    if (hit && hit.expires > now) return hit.policy;

    let row = await DbService.repository.tiers.findBySlug(slug);
    if (!row) {
      logger.warn({ slug }, "Unknown tier slug; falling back to default tier");
      if (slug !== TierService.DEFAULT_TIER) {
        row = await DbService.repository.tiers.findBySlug(
          TierService.DEFAULT_TIER
        );
      }
      if (!row) {
        throw new ApiError(
          500,
          ApiCode.TIER_DEFAULT_MISSING,
          "Default subscription tier is not seeded"
        );
      }
    }

    const policy = TierService.tierPolicyFromRow(row);
    TierService.cache.set(slug, { policy, expires: now + CACHE_TTL_MS });
    return policy;
  }

  /**
   * The `"YYYY-MM"` id of the billing period containing `at`, in UTC. The
   * period starts on `anchorDay`; a date before the anchor belongs to the
   * previous month's period.
   */
  static periodIdFor(period: TierPolicy["period"], at: Date): string {
    let year = at.getUTCFullYear();
    let month = at.getUTCMonth(); // 0-based
    if (at.getUTCDate() < period.anchorDay) {
      month -= 1;
      if (month < 0) {
        month = 11;
        year -= 1;
      }
    }
    return `${year}-${String(month + 1).padStart(2, "0")}`;
  }

  /** Drop cached policies (a specific slug, or all). Call after a tier write. */
  static invalidate(slug?: string): void {
    if (slug) TierService.cache.delete(slug);
    else TierService.cache.clear();
  }
}
