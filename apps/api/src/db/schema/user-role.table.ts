import { pgTable, text, index, uniqueIndex } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { baseColumns } from "./base.columns.js";
import { organizations } from "./organizations.table.js";
import { users } from "./users.table.js";
import { roles } from "./roles.table.js";

/**
 * User–Role assignments (#620) — the many-to-many join replacing the single
 * `organization_users.role` enum. A user holds any number of `roles` per org;
 * `loadSet` gathers the union of their policies. Org-scoped (`roleId` → an org's
 * role; `organizationId` denormalized for the `(userId, org)` gather).
 */
export const userRole = pgTable(
  "user_role",
  {
    ...baseColumns,
    userId: text("user_id")
      .notNull()
      .references(() => users.id),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id),
    roleId: text("role_id")
      .notNull()
      .references(() => roles.id),
  },
  (t) => [
    index("user_role_user_org_idx").on(t.userId, t.organizationId),
    // A role can't be assigned to a user twice (re-assign is a no-op).
    uniqueIndex("user_role_unique")
      .on(t.userId, t.organizationId, t.roleId)
      .where(sql`${t.deleted} IS NULL`),
  ]
);
