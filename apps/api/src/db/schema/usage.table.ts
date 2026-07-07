import { pgTable, text, integer, uniqueIndex, check } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { baseColumns } from "./base.columns.js";
import { organizations } from "./organizations.table.js";

/**
 * Per-org, per-period usage balance (#172).
 *
 * One row per `(organizationId, periodId, costClass)`. The cost gate (#169)
 * increments `unitsUsed` via an atomic UPSERT (see `UsageRepository.increment`)
 * as part of its charge; `UsageService.getBalance` reads it for
 * `available = allocation − unitsUsed`. Kept in sync with `UsageSchema` in
 * `@portalai/core` via `type-checks.ts`.
 */
export const usage = pgTable(
  "usage",
  {
    ...baseColumns,
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id),
    periodId: text("period_id").notNull(),
    costClass: text("cost_class").notNull(),
    unitsUsed: integer("units_used").notNull().default(0),
  },
  (t) => [
    // Soft-delete-aware partial unique index — the ON CONFLICT arbiter for the
    // atomic increment (repo passes `targetWhere: deleted IS NULL`).
    uniqueIndex("usage_org_period_class_unique")
      .on(t.organizationId, t.periodId, t.costClass)
      .where(sql`deleted IS NULL`),
    check(
      "usage_cost_class_check",
      sql`${t.costClass} IN ('free', 'metered', 'expensive')`
    ),
    check("usage_units_nonneg", sql`${t.unitsUsed} >= 0`),
  ]
);
