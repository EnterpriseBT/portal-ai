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

  /**
   * Atomically charge `row.unitsUsed` to `(organizationId, periodId, costClass)`
   * **only if** the post-charge total stays within `allocation`. Returns the
   * new `unitsUsed` on success, or `null` if the charge would exceed the
   * allocation (denied). `allocation === null` means unlimited → always charges.
   *
   * The conditional `UPDATE` is atomic per row (row-level lock), so concurrent
   * charges serialize and cannot overshoot the allocation; the seed `INSERT` is
   * idempotent (`DO NOTHING`). No explicit transaction needed — the guarded
   * `UPDATE` is the arbiter.
   */
  async chargeConditional(
    row: UsageInsert,
    allocation: number | null,
    client: DbClient = db
  ): Promise<number | null> {
    const units = row.unitsUsed ?? 0;

    // 1. Ensure the (org, period, class) row exists at 0 (idempotent).
    await (client as typeof db)
      .insert(usage)
      .values({ ...row, unitsUsed: 0 })
      .onConflictDoNothing({
        target: [usage.organizationId, usage.periodId, usage.costClass],
        where: isNull(usage.deleted),
      });

    // 2. Atomic conditional increment.
    const conditions = [
      eq(usage.organizationId, row.organizationId),
      eq(usage.periodId, row.periodId),
      eq(usage.costClass, row.costClass),
      isNull(usage.deleted),
    ];
    if (allocation !== null) {
      conditions.push(sql`${usage.unitsUsed} + ${units} <= ${allocation}`);
    }

    const [updated] = await (client as typeof db)
      .update(usage)
      .set({
        unitsUsed: sql`${usage.unitsUsed} + ${units}`,
        updated: row.created,
        updatedBy: row.createdBy,
      })
      .where(and(...conditions))
      .returning({ unitsUsed: usage.unitsUsed });

    return updated ? updated.unitsUsed : null;
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
