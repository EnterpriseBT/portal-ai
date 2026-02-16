import { text, bigint } from "drizzle-orm/pg-core";

/**
 * Base columns shared by all tables.
 *
 * Mirrors the BaseModelSchema from @mcp-ui/core:
 *   id, created, createdBy, updated, updatedBy, deleted, deletedBy
 *
 * Usage: spread into any pgTable definition:
 *   pgTable("my_table", { ...baseColumns, myField: text("my_field") })
 */
export const baseColumns = {
  id: text("id").primaryKey(),
  created: bigint("created", { mode: "number" }).notNull(),
  createdBy: text("created_by").notNull(),
  updated: bigint("updated", { mode: "number" }),
  updatedBy: text("updated_by"),
  deleted: bigint("deleted", { mode: "number" }),
  deletedBy: text("deleted_by"),
};
