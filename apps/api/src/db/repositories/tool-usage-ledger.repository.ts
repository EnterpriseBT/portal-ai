/**
 * Repository for the `tool_usage_ledger` table (#179).
 *
 * `insertIfNew` is the append-only idempotency gate (FULL unique on
 * `tool_call_id` — concurrent double-commits resolve to one row);
 * `findPage` is the org-scoped paginated read behind
 * `GET /api/organization/usage/ledger`; `deleteOlderThan` is the
 * retention purge's batch seam.
 */

import { and, eq, ilike, lt, sql, asc, desc, inArray } from "drizzle-orm";
import { toolUsageLedger } from "../schema/index.js";
import { db } from "../client.js";
import { Repository, type DbClient } from "./base.repository.js";
import type {
  ToolUsageLedgerSelect,
  ToolUsageLedgerInsert,
} from "../schema/zod.js";

/** sortBy allow-map for the list read (spec D4). */
const SORTABLE_COLUMNS = {
  created: toolUsageLedger.created,
  units: toolUsageLedger.units,
  toolName: toolUsageLedger.toolName,
} as const;

export type ToolUsageLedgerSortBy = keyof typeof SORTABLE_COLUMNS;

/** The allow-map's keys — the route validates `sortBy` against these. */
export const TOOL_USAGE_LEDGER_SORT_KEYS = Object.keys(
  SORTABLE_COLUMNS
) as ToolUsageLedgerSortBy[];

export class ToolUsageLedgerRepository extends Repository<
  typeof toolUsageLedger,
  ToolUsageLedgerSelect,
  ToolUsageLedgerInsert
> {
  constructor() {
    super(toolUsageLedger);
  }

  /**
   * Atomic append-only insert. Returns `false` when the `toolCallId` was
   * already recorded (a double-commit / processor retry) — the caller
   * treats that as a no-op, never an error.
   */
  async insertIfNew(
    row: ToolUsageLedgerInsert,
    client: DbClient = db
  ): Promise<boolean> {
    const inserted = await (client as typeof db)
      .insert(toolUsageLedger)
      .values(row)
      .onConflictDoNothing({ target: toolUsageLedger.toolCallId })
      .returning({ id: toolUsageLedger.id });
    return inserted.length > 0;
  }

  /** Org-scoped page + filter-scoped total for the itemized usage read. */
  async findPage(
    organizationId: string,
    opts: {
      periodId?: string;
      toolName?: string;
      /** Case-insensitive substring match on the tool name. */
      search?: string;
      limit: number;
      offset: number;
      sortBy: ToolUsageLedgerSortBy;
      sortOrder: "asc" | "desc";
    },
    client: DbClient = db
  ): Promise<{ entries: ToolUsageLedgerSelect[]; total: number }> {
    const conditions = [
      eq(toolUsageLedger.organizationId, organizationId),
      this.notDeleted(),
    ];
    if (opts.periodId) {
      conditions.push(eq(toolUsageLedger.periodId, opts.periodId));
    }
    if (opts.toolName) {
      conditions.push(eq(toolUsageLedger.toolName, opts.toolName));
    }
    if (opts.search) {
      conditions.push(ilike(toolUsageLedger.toolName, `%${opts.search}%`));
    }
    const where = and(...conditions);

    const column = SORTABLE_COLUMNS[opts.sortBy];
    const entries = await (client as typeof db)
      .select()
      .from(this.table)
      .where(where)
      .orderBy(opts.sortOrder === "asc" ? asc(column) : desc(column))
      .limit(opts.limit)
      .offset(opts.offset);

    const [{ count }] = await (client as typeof db)
      .select({ count: sql<number>`count(*)::int` })
      .from(this.table)
      .where(where);

    return { entries, total: count };
  }

  /**
   * Retention purge (#179 D5): hard-delete up to `batchSize` rows created
   * before `cutoffMs`. Returns rows deleted — the purge processor loops
   * until 0. Batched via an id-subquery so each statement's lock time is
   * bounded.
   */
  async deleteOlderThan(
    cutoffMs: number,
    batchSize: number,
    client: DbClient = db
  ): Promise<number> {
    const batch = (client as typeof db)
      .select({ id: toolUsageLedger.id })
      .from(toolUsageLedger)
      .where(lt(toolUsageLedger.created, cutoffMs))
      .limit(batchSize);

    const deleted = await (client as typeof db)
      .delete(toolUsageLedger)
      .where(inArray(toolUsageLedger.id, batch))
      .returning({ id: toolUsageLedger.id });

    return deleted.length;
  }
}

/** Singleton instance — import this in services. */
export const toolUsageLedgerRepo = new ToolUsageLedgerRepository();
