import { pgTable, text, index, check } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import {
  PERMISSION_EFFECTS,
  PERMISSION_VERBS,
  PERMISSION_RESOURCE_TYPES,
  PERMISSION_CONDITIONS,
  POLICY_PRINCIPAL_TYPES,
} from "@portalai/core/models";
import { baseColumns } from "./base.columns.js";
import { organizations } from "./organizations.table.js";

/**
 * RBAC ad-hoc object grants (#621) — the same allow/deny shape as
 * `permission_statements`, but **principal-bearing** (`principal_type` +
 * `principal_id`) instead of policy-attached, so "share object X with U/team"
 * is one row unioned into the resolver by principal. Indexed for the two hot
 * paths: gather-by-principal (the resolver) and list-by-resource (the share
 * list + lifecycle cascade). Grants hard-delete (no soft-delete tombstones for
 * authz rows).
 */
export const permissionGrants = pgTable(
  "permission_grants",
  {
    ...baseColumns,
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id),
    principalType: text("principal_type", {
      enum: POLICY_PRINCIPAL_TYPES,
    }).notNull(),
    principalId: text("principal_id").notNull(),
    effect: text("effect", { enum: PERMISSION_EFFECTS }).notNull(),
    verb: text("verb", { enum: PERMISSION_VERBS }).notNull(),
    resourceType: text("resource_type", {
      enum: PERMISSION_RESOURCE_TYPES,
    }).notNull(),
    resourceId: text("resource_id"),
    condition: text("condition", { enum: PERMISSION_CONDITIONS }),
  },
  (t) => [
    index("permission_grants_principal_idx").on(
      t.organizationId,
      t.principalId,
      t.resourceType
    ),
    index("permission_grants_resource_idx").on(
      t.organizationId,
      t.resourceType,
      t.resourceId
    ),
    check(
      "permission_grants_effect_check",
      sql`${t.effect} IN ('allow', 'deny')`
    ),
    check(
      "permission_grants_principal_type_check",
      sql`${t.principalType} IN ('user', 'role')`
    ),
    check(
      "permission_grants_condition_check",
      sql`${t.condition} IS NULL OR ${t.condition} IN ('created_by_caller', 'created_by_system')`
    ),
  ]
);
