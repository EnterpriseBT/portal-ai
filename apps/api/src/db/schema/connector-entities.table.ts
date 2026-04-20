import { pgTable, text, uniqueIndex } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { baseColumns } from "./base.columns.js";
import { organizations } from "./organizations.table.js";
import { connectorInstances } from "./connector-instances.table.js";

/**
 * Connector entities table.
 * Each row represents a distinct data object exposed by a connector
 * instance (e.g. "Contacts", "Deals", "Users").
 */
export const connectorEntities = pgTable(
  "connector_entities",
  {
    ...baseColumns,
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id),
    connectorInstanceId: text("connector_instance_id")
      .notNull()
      .references(() => connectorInstances.id),
    key: text("key").notNull(),
    label: text("label").notNull(),
  },
  (table) => [
    uniqueIndex("connector_entities_instance_key_unique")
      .on(table.connectorInstanceId, table.key)
      .where(sql`deleted IS NULL`),
  ]
);
