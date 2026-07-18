import {
  pgTable,
  text,
  integer,
  unique,
  index,
  check,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { baseColumns } from "./base.columns.js";
import { organizations } from "./organizations.table.js";

/**
 * Tool usage audit ledger (#179) — one row per **committed** tool-call
 * charge: the itemized trail behind the aggregate `usage` balance.
 *
 * Append-only, no reversal rows (#183 bills on success, never refunds).
 * Rows are written inside the same transaction as the aggregate charge
 * (`CostGateService.commitCharge`), so the ledger provably sums to the
 * billed balance. Retained on org delete like `usage` (#197 billing
 * record-of-truth) and purged by the retention job past
 * `LEDGER_RETENTION_MONTHS`.
 *
 * Kept in sync with `ToolUsageLedgerEntrySchema` in `@portalai/core` via
 * `type-checks.ts`.
 */
export const toolUsageLedger = pgTable(
  "tool_usage_ledger",
  {
    ...baseColumns,
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id),
    toolName: text("tool_name").notNull(),
    /** Stable per-call id — the AI SDK's toolCallId, `job:<jobId>`, or a
     *  synthesized UUID. The dedup key. */
    toolCallId: text("tool_call_id").notNull(),
    stationId: text("station_id").notNull(),
    portalId: text("portal_id"),
    // TS-narrowed to the charged classes; `free` never commits a charge.
    costClass: text("cost_class", {
      enum: ["metered", "expensive"],
    }).notNull(),
    units: integer("units").notNull(),
    periodId: text("period_id").notNull(),
    userId: text("user_id").notNull(),
  },
  (t) => [
    // FULL unique — the atomic idempotency arbiter (stripe_events pattern).
    unique("tool_usage_ledger_tool_call_id_unique").on(t.toolCallId),
    // The list read's access path (org + billing period).
    index("tool_usage_ledger_org_period_idx").on(t.organizationId, t.periodId),
    check(
      "tool_usage_ledger_cost_class_check",
      sql`${t.costClass} IN ('metered', 'expensive')`
    ),
    check("tool_usage_ledger_units_positive", sql`${t.units} > 0`),
  ]
);
