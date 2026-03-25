import { pgTable, text, jsonb, pgEnum } from "drizzle-orm/pg-core";
import { baseColumns } from "./base.columns.js";
import { portals } from "./portals.table.js";
import { organizations } from "./organizations.table.js";

/**
 * Portal message role enum.
 */
export const portalMessageRoleEnum = pgEnum("portal_message_role", [
  "user",
  "assistant",
]);

/**
 * Portal messages table.
 * Stores individual messages in a portal chat session.
 */
export const portalMessages = pgTable("portal_messages", {
  ...baseColumns,
  portalId: text("portal_id")
    .notNull()
    .references(() => portals.id),
  organizationId: text("organization_id")
    .notNull()
    .references(() => organizations.id),
  role: portalMessageRoleEnum("role").notNull(),
  blocks: jsonb("blocks").$type<Record<string, unknown>[]>().notNull(),
});
