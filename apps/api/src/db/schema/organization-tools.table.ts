import { pgTable, text, jsonb } from "drizzle-orm/pg-core";
import { baseColumns } from "./base.columns.js";
import { organizations } from "./organizations.table.js";

/**
 * Organization tools table.
 * Org-scoped webhook tool definitions that can be assigned to stations.
 */
export const organizationTools = pgTable("organization_tools", {
  ...baseColumns,
  organizationId: text("organization_id")
    .notNull()
    .references(() => organizations.id),
  name: text("name").notNull(),
  description: text("description"),
  parameterSchema: jsonb("parameter_schema")
    .$type<Record<string, unknown>>()
    .notNull(),
  implementation: jsonb("implementation")
    .$type<{ type: "webhook"; url: string; headers?: Record<string, string> }>()
    .notNull(),
});
