/**
 * Repository for the `audit_log` table (#575).
 *
 * Append-only by construction: it surfaces `append` (insert) and org-scoped
 * reads only — no update/soft-delete/hard-delete methods. The single delete
 * path is `deleteOlderThan` (the retention purge), which sets the
 * `app.audit_retention_purge` session flag so the DB's append-only trigger
 * (migration 0094) permits it. The trigger blocks every other UPDATE/DELETE.
 */

import { and, eq, lt, sql, asc, desc, inArray } from "drizzle-orm";
import { auditLog } from "../schema/index.js";
import { db } from "../client.js";
import { Repository, type DbClient } from "./base.repository.js";
import type { AuditLogSelect, AuditLogInsert } from "../schema/zod.js";
import type { AuditAction, AuditOutcome } from "@portalai/core/models";

/** sortBy allow-map for the list read — the route validates against these. */
const SORTABLE_COLUMNS = {
  created: auditLog.created,
} as const;

export type AuditLogSortBy = keyof typeof SORTABLE_COLUMNS;

export const AUDIT_LOG_SORT_KEYS = Object.keys(
  SORTABLE_COLUMNS
) as AuditLogSortBy[];

export class AuditLogRepository extends Repository<
  typeof auditLog,
  AuditLogSelect,
  AuditLogInsert
> {
  constructor() {
    super(auditLog);
  }

  /**
   * Append-only insert. The only write path the app exposes for `audit_log`
   * (the DB trigger blocks UPDATE/DELETE); emission goes through
   * `AuditService.record`, which is fail-open around this call.
   */
  async append(row: AuditLogInsert, client: DbClient = db): Promise<void> {
    await (client as typeof db).insert(auditLog).values(row);
  }

  /** Org-scoped page + filter-scoped total for the audit-trail read. */
  async findPage(
    organizationId: string,
    opts: {
      action?: AuditAction;
      outcome?: AuditOutcome;
      limit: number;
      offset: number;
      sortBy: AuditLogSortBy;
      sortOrder: "asc" | "desc";
    },
    client: DbClient = db
  ): Promise<{ entries: AuditLogSelect[]; total: number }> {
    const conditions = [
      eq(auditLog.organizationId, organizationId),
      this.notDeleted(),
    ];
    if (opts.action) {
      conditions.push(eq(auditLog.action, opts.action));
    }
    if (opts.outcome) {
      conditions.push(eq(auditLog.outcome, opts.outcome));
    }
    const where = and(...conditions);

    const column = SORTABLE_COLUMNS[opts.sortBy];
    // #433: every paginated ORDER BY ends in a unique tiebreaker (`id`), in
    // the same direction, so offset pagination never repeats or skips a row.
    const order =
      opts.sortOrder === "asc"
        ? [asc(column), asc(auditLog.id)]
        : [desc(column), desc(auditLog.id)];

    const entries = await (client as typeof db)
      .select()
      .from(this.table)
      .where(where)
      .orderBy(...order)
      .limit(opts.limit)
      .offset(opts.offset);

    const [{ count }] = await (client as typeof db)
      .select({ count: sql<number>`count(*)::int` })
      .from(this.table)
      .where(where);

    return { entries, total: count };
  }

  /**
   * Retention purge (#575 slice 5): hard-delete up to `batchSize` rows created
   * before `cutoffMs`. Returns rows deleted — the purge processor loops until
   * 0. Runs inside a transaction that first sets the
   * `app.audit_retention_purge` flag so the append-only trigger permits these
   * DELETEs; `SET LOCAL` scopes the flag to this transaction only. Batched via
   * an id-subquery so each statement's lock time is bounded.
   */
  async deleteOlderThan(
    cutoffMs: number,
    batchSize: number,
    client: DbClient = db
  ): Promise<number> {
    const run = async (tx: DbClient): Promise<number> => {
      await (tx as typeof db).execute(
        sql`SET LOCAL app.audit_retention_purge = 'on'`
      );
      const batch = (tx as typeof db)
        .select({ id: auditLog.id })
        .from(auditLog)
        .where(lt(auditLog.created, cutoffMs))
        .limit(batchSize);

      const deleted = await (tx as typeof db)
        .delete(auditLog)
        .where(inArray(auditLog.id, batch))
        .returning({ id: auditLog.id });

      return deleted.length;
    };

    // `SET LOCAL` requires a transaction. Re-use one if provided.
    if (client !== db) return run(client);
    return db.transaction((tx) => run(tx));
  }
}

/** Singleton instance — import this in services. */
export const auditLogRepo = new AuditLogRepository();
