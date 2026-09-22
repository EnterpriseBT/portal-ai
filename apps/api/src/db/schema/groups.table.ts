import { pgTable, text, uniqueIndex } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { baseColumns } from "./base.columns.js";
import { organizations } from "./organizations.table.js";

/**
 * RBAC groups (#622) — a named `policy_attachment` principal alongside
 * `user`/`role`. A member inherits the policies of every group they belong to
 * (via `user_group`). Org-defined only — no `system`/`custom` kind. `name` is
 * unique per org among live rows (mirrors `roles.roles_org_name_unique`).
 */
export const groups = pgTable(
  "groups",
  {
    ...baseColumns,
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id),
    name: text("name").notNull(),
    description: text("description"),
  },
  (t) => [
    uniqueIndex("groups_org_name_unique")
      .on(t.organizationId, t.name)
      .where(sql`${t.deleted} IS NULL`),
  ]
);
