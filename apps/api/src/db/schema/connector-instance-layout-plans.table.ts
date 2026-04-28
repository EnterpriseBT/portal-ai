import { index, jsonb, pgTable, text } from "drizzle-orm/pg-core";

import type { InterpretationTrace, LayoutPlan } from "@portalai/core/contracts";

import { baseColumns } from "./base.columns.js";
import { connectorInstances } from "./connector-instances.table.js";

/**
 * Versioned `LayoutPlan` persistence per connector instance. One row per
 * plan revision — `supersededBy` links the older plan to its replacement.
 *
 * `plan` stores the full `LayoutPlan` as JSONB (validated at boundary via
 * `LayoutPlanSchema`). `interpretationTrace` captures checkpointed stage
 * artifacts from `interpret()` for audit and UI introspection.
 *
 * `revisionTag` is used by cloud-spreadsheet connectors (Google Sheets,
 * Excel Online) to pin a plan to a remote revision identifier; null for
 * file-upload / snapshot consumers.
 *
 * See `docs/SPREADSHEET_PARSING.backend.spec.md` §"New table:
 * connector_instance_layout_plans".
 */
export const connectorInstanceLayoutPlans = pgTable(
  "connector_instance_layout_plans",
  {
    ...baseColumns,
    connectorInstanceId: text("connector_instance_id")
      .notNull()
      .references(() => connectorInstances.id),
    planVersion: text("plan_version").notNull(),
    revisionTag: text("revision_tag"),
    plan: jsonb("plan").$type<LayoutPlan>().notNull(),
    interpretationTrace: jsonb(
      "interpretation_trace"
    ).$type<InterpretationTrace | null>(),
    /** Self-FK to the plan that supersedes this one; null when current. */
    supersededBy: text("superseded_by"),
  },
  (table) => [
    index("cilp_instance_current_idx").on(
      table.connectorInstanceId,
      table.supersededBy
    ),
  ]
);
