import { pgTable, text, boolean, jsonb } from "drizzle-orm/pg-core";
import { baseColumns } from "./base.columns.js";

export interface CapabilityFlags {
  sync?: boolean;
  query?: boolean;
  write?: boolean;
}

/**
 * Connector definitions table.
 */
export const connectorDefinitions = pgTable("connector_definitions", {
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
});
