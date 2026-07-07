/**
 * UsageService — the per-org usage balance (#172).
 *
 * `increment` is the seam the cost gate (#169) calls as part of its atomic
 * charge; `getBalance` computes `available = allocation − used` per cost class
 * for the current billing period (the Settings display reads this). #172 owns
 * the durable balance; #169 owns the charging.
 */

import { DbService } from "./db.service.js";
import { TierService } from "./tier.service.js";
import { UsageModelFactory } from "@portalai/core/models";
import type { CostHint, TierPolicy } from "@portalai/core/models";
import type { DbClient } from "../db/repositories/base.repository.js";

const COST_CLASSES: readonly CostHint[] = ["free", "metered", "expensive"];

export interface UsageBalance {
  periodId: string;
  byClass: Record<CostHint, { used: number; available: number | null }>;
}

export class UsageService {
  /**
   * Add `units` to the org's usage for `costClass` in `periodId`. No-op for
   * non-positive units. The concurrency-safe UPSERT lives in the repository.
   */
  static async increment(
    organizationId: string,
    costClass: CostHint,
    units: number,
    periodId: string,
    actor: { userId: string },
    client?: DbClient
  ): Promise<void> {
    if (units <= 0) return;

    const row = new UsageModelFactory()
      .create(actor.userId)
      .update({ organizationId, periodId, costClass, unitsUsed: units })
      .parse();

    await DbService.repository.usage.increment(row, client);
  }

  /**
   * Current-period balance per cost class. `used` defaults to 0 when no row
   * exists; `available` is `null` for an unlimited class and never negative.
   */
  static async getBalance(
    org: { id: string },
    policy: TierPolicy,
    at: Date
  ): Promise<UsageBalance> {
    const periodId = TierService.periodIdFor(policy.period, at);
    const rows = await DbService.repository.usage.findForPeriod(
      org.id,
      periodId
    );

    const usedByClass: Record<string, number> = {};
    for (const r of rows) usedByClass[r.costClass] = r.unitsUsed;

    const byClass = {} as Record<
      CostHint,
      { used: number; available: number | null }
    >;
    for (const cls of COST_CLASSES) {
      const alloc = policy.allocations[cls].unitsPerPeriod;
      const used = usedByClass[cls] ?? 0;
      byClass[cls] = {
        used,
        available: alloc === null ? null : Math.max(0, alloc - used),
      };
    }

    return { periodId, byClass };
  }
}
