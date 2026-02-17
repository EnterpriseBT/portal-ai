import { pgTable, text } from "drizzle-orm/pg-core";
import { baseColumns } from "./base.columns.js";
import { organizations } from "./organizations.table.js";
import { users } from "./users.table.js";

/**
 * Join table linking organizations and users (many-to-many).
 */
export const organizationUsers = pgTable("organization_users", {
  ...baseColumns,
  organizationId: text("organization_id")
    .notNull()
    .references(() => organizations.id),
  userId: text("user_id")
    .notNull()
    .references(() => users.id),
});
