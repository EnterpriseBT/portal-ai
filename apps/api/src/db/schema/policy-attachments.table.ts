import { pgTable, text, index, uniqueIndex, check } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { POLICY_PRINCIPAL_TYPES } from "@portalai/core/models";
import { baseColumns } from "./base.columns.js";
import { organizations } from "./organizations.table.js";
import { permissionPolicies } from "./permission-policies.table.js";

/**
 * RBAC policy attachments (#598) — the polymorphic edge binding a policy to a
 * principal. `user` and `role` in #598; `group` is added in #622. A user's
 * effective policy set is the union of policies attached directly + via each of
 * their roles.
 */
export const policyAttachments = pgTable(
  "policy_attachments",
  {
    ...baseColumns,
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id),
    policyId: text("policy_id")
      .notNull()
      .references(() => permissionPolicies.id),
    principalType: text("principal_type", {
      enum: POLICY_PRINCIPAL_TYPES,
    }).notNull(),
    principalId: text("principal_id").notNull(),
  },
  (t) => [
    index("policy_attachments_principal_idx").on(
      t.principalType,
      t.principalId
    ),
    uniqueIndex("policy_attachments_unique")
      .on(t.policyId, t.principalType, t.principalId)
      .where(sql`${t.deleted} IS NULL`),
    check(
      "policy_attachments_principal_type_check",
      sql`${t.principalType} IN ('user', 'role')`
    ),
  ]
);
