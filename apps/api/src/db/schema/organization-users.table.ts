import { bigint, pgTable, text, check } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { ORG_ROLES } from "@portalai/core/models";
import { baseColumns } from "./base.columns.js";
import { organizations } from "./organizations.table.js";
import { users } from "./users.table.js";

/**
 * Join table linking organizations and users (many-to-many).
 *
 * `role` (#576): the per-membership authorization role. `{ enum }` gives the
 * typed column + drizzle-zod reconciliation; the CHECK is the DB-level guard.
 * DEFAULT 'member' backfills existing rows on migrate (the owner backfill
 * `UPDATE` follows in the same migration); every app creation site still sets
 * it explicitly.
 */
export const organizationUsers = pgTable(
  "organization_users",
  {
    ...baseColumns,
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id),
    userId: text("user_id")
      .notNull()
      .references(() => users.id),
    role: text("role", { enum: ORG_ROLES }).notNull().default("member"),
    lastLogin: bigint("last_login", { mode: "number" }),
  },
  (t) => [
    check(
      "organization_users_role_check",
      sql`${t.role} IN ('owner', 'admin', 'member')`
    ),
  ]
);
