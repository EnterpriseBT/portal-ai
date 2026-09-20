import { pgTable, text, uniqueIndex, check } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { RBAC_KINDS } from "@portalai/core/models";
import { baseColumns } from "./base.columns.js";
import { organizations } from "./organizations.table.js";

/**
 * RBAC roles (#598) — a named policy-attachment principal. Seeded per org as
 * the three immutable system roles (`owner`/`admin`/`member`); `custom` roles
 * are org-defined (#622). For #598 the single role assignment stays on
 * `organization_users.role`; the `user_role` multi-role join is #620.
 */
export const roles = pgTable(
  "roles",
  {
    ...baseColumns,
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id),
    name: text("name").notNull(),
    kind: text("kind", { enum: RBAC_KINDS }).notNull(),
  },
  (t) => [
    uniqueIndex("roles_org_name_unique")
      .on(t.organizationId, t.name)
      .where(sql`${t.deleted} IS NULL`),
    check("roles_kind_check", sql`${t.kind} IN ('system', 'custom')`),
  ]
);
