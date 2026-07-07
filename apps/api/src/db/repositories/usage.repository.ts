/**
 * Repository for the `usage` table (#172).
 *
 * The `increment` method is the concurrency-safe seam the cost gate (#169)
 * calls: an atomic `INSERT ... ON CONFLICT DO UPDATE` that accumulates units
 * per `(organizationId, periodId, costClass)`. Correct under concurrent
 * charges — the arbiter is the partial unique index.
 */

import { eq, and, isNull, sql } from "drizzle-orm";
import { usage } from "../schema/index.js";
import { db } from "../client.js";
import { Repository, type DbClient } from "./base.repository.js";
import type { UsageSelect, UsageInsert } from "../schema/zod.js";

export class UsageRepository extends Repository<
  typeof usage,
  UsageSelect,
  UsageInsert
> {
  constructor() {
    super(usage);
  }

  /**
   * Atomically add `row.unitsUsed` to the balance for
   * `(organizationId, periodId, costClass)`, inserting the row if absent.
   * Concurrent callers accumulate correctly (no lost updates).
   */
  async increment(row: UsageInsert, client: DbClient = db): Promise<void> {
    const amount = row.unitsUsed ?? 0;
    await (client as typeof db)
      .insert(usage)
      .values(row)
      .onConflictDoUpdate({
        target: [usage.organizationId, usage.periodId, usage.costClass],
        targetWhere: isNull(usage.deleted),
        set: {
          unitsUsed: sql`${usage.unitsUsed} + ${amount}`,
          updated: row.created,
          updatedBy: row.createdBy,
        },
      });
  }

  /** All live usage rows for an org in a given billing period. */
  async findForPeriod(
    organizationId: string,
    periodId: string,
    client: DbClient = db
  ): Promise<UsageSelect[]> {
    return (client as typeof db)
      .select()
      .from(this.table)
      .where(
        and(
          eq(usage.organizationId, organizationId),
          eq(usage.periodId, periodId),
          this.notDeleted()
        )
      );
  }
}

/** Singleton instance — import this in services. */
export const usageRepo = new UsageRepository();
