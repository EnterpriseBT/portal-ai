import { pgTable, text, uniqueIndex, check } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { RBAC_KINDS } from "@portalai/core/models";
import { baseColumns } from "./base.columns.js";
import { organizations } from "./organizations.table.js";

/**
 * RBAC policies (#598) — a named bundle of statements. Seeded per org as the
 * three immutable system policies (`FullAccess`/`AdminAccess`/`MemberAccess`);
 * `custom` policies are org-defined (#622). `kind = system` is immutable.
 */
export const permissionPolicies = pgTable(
  "permission_policies",
  {
    ...baseColumns,
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id),
    name: text("name").notNull(),
    kind: text("kind", { enum: RBAC_KINDS }).notNull(),
    description: text("description"),
  },
  (t) => [
    // Full name uniqueness per org (partial on the soft-delete guard).
    uniqueIndex("permission_policies_org_name_unique")
      .on(t.organizationId, t.name)
      .where(sql`${t.deleted} IS NULL`),
    check(
      "permission_policies_kind_check",
      sql`${t.kind} IN ('system', 'custom')`
    ),
  ]
);
