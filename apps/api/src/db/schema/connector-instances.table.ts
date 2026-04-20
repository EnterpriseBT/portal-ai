import { pgTable, text, bigint, jsonb, pgEnum } from "drizzle-orm/pg-core";
import { baseColumns } from "./base.columns.js";

export interface EnabledCapabilityFlags {
  sync?: boolean;
  read?: boolean;
  write?: boolean;
  push?: boolean;
}

export const connectorInstanceStatusEnum = pgEnum("connector_instance_status", [
  "active",
  "inactive",
  "error",
  "pending",
]);

/**
 * Connector instances table.
 * Each row represents a configured instance of a connector definition,
 * scoped to an organization.
 */
export const connectorInstances = pgTable("connector_instances", {
  ...baseColumns,
  connectorDefinitionId: text("connector_definition_id").notNull(),
  organizationId: text("organization_id").notNull(),
  name: text("name").notNull(),
  status: connectorInstanceStatusEnum("status").notNull(),
  config: jsonb("config").$type<Record<string, unknown>>(),
  credentials: text("credentials"),
  lastSyncAt: bigint("last_sync_at", { mode: "number" }),
  lastErrorMessage: text("last_error_message"),
  enabledCapabilityFlags: jsonb(
    "enabled_capability_flags"
  ).$type<EnabledCapabilityFlags>(),
});
