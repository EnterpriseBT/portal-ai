import { pgTable, text, index, uniqueIndex } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { baseColumns } from "./base.columns.js";
import { organizations } from "./organizations.table.js";
import { users } from "./users.table.js";
import { groups } from "./groups.table.js";

/**
 * User–Group membership (#622) — the many-to-many join backing the `group`
 * principal. `loadSet` gathers a user's group ids (`(userId, organizationId)`)
 * and unions each group's attached policies. A user can't be added to a group
 * twice among live rows (re-add is a no-op).
 */
export const userGroup = pgTable(
  "user_group",
  {
    ...baseColumns,
    userId: text("user_id")
      .notNull()
      .references(() => users.id),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id),
    groupId: text("group_id")
      .notNull()
      .references(() => groups.id),
  },
  (t) => [
    index("user_group_user_org_idx").on(t.userId, t.organizationId),
    uniqueIndex("user_group_unique")
      .on(t.userId, t.groupId)
      .where(sql`${t.deleted} IS NULL`),
  ]
);
