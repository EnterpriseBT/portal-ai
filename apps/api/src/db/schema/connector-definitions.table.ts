import { pgTable, text, boolean, jsonb, uniqueIndex } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { baseColumns } from "./base.columns.js";

export interface CapabilityFlags {
  sync?: boolean;
  read?: boolean;
  write?: boolean;
  push?: boolean;
}

/**
 * Connector definitions table.
 */
export const connectorDefinitions = pgTable(
  "connector_definitions",
  {
    ...baseColumns,
    slug: text("slug").notNull(),
    display: text("display").notNull(),
    category: text("category").notNull(),
    authType: text("auth_type").notNull(),
    configSchema: jsonb("config_schema").$type<Record<string, unknown>>(),
    capabilityFlags: jsonb("capability_flags").$type<CapabilityFlags>().notNull(),
    isActive: boolean("is_active").notNull(),
    version: text("version").notNull(),
    iconUrl: text("icon_url"),
  },
  (table) => [
    uniqueIndex("connector_definitions_slug_unique")
      .on(table.slug)
      .where(sql`deleted IS NULL`),
  ],
);
