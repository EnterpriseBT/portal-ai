import { pgTable, text, index, check } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import {
  PERMISSION_EFFECTS,
  PERMISSION_VERBS,
  PERMISSION_RESOURCE_TYPES,
  PERMISSION_CONDITIONS,
} from "@portalai/core/models";
import { baseColumns } from "./base.columns.js";
import { organizations } from "./organizations.table.js";
import { permissionPolicies } from "./permission-policies.table.js";

/**
 * RBAC statements (#598) — a policy's allow/deny rules over `verb × resourceType`.
 * `resource_id` NULL = class-level (`type:*`); set = a specific instance.
 * `condition` is the bounded ownership vocabulary (evaluated at resolve time /
 * translated to a `created_by` SQL predicate). Indexed for the list-visibility
 * predicate (#440: resolve as one SQL clause, never per-row).
 */
export const permissionStatements = pgTable(
  "permission_statements",
  {
    ...baseColumns,
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id),
    policyId: text("policy_id")
      .notNull()
      .references(() => permissionPolicies.id),
    effect: text("effect", { enum: PERMISSION_EFFECTS }).notNull(),
    verb: text("verb", { enum: PERMISSION_VERBS }).notNull(),
    resourceType: text("resource_type", {
      enum: PERMISSION_RESOURCE_TYPES,
    }).notNull(),
    resourceId: text("resource_id"),
    condition: text("condition", { enum: PERMISSION_CONDITIONS }),
  },
  (t) => [
    index("permission_statements_policy_idx").on(t.policyId),
    index("permission_statements_resource_idx").on(
      t.organizationId,
      t.resourceType,
      t.resourceId
    ),
    check(
      "permission_statements_effect_check",
      sql`${t.effect} IN ('allow', 'deny')`
    ),
    check(
      "permission_statements_condition_check",
      sql`${t.condition} IS NULL OR ${t.condition} IN ('created_by_caller', 'created_by_system')`
    ),
  ]
);
