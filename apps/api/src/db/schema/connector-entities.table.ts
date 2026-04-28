import { pgTable, text, uniqueIndex } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { baseColumns } from "./base.columns.js";
import { organizations } from "./organizations.table.js";
import { connectorInstances } from "./connector-instances.table.js";

/**
 * Connector entities table.
 * Each row represents a distinct data object exposed by a connector
 * instance (e.g. "Contacts", "Deals", "Users").
 *
 * C2: `key` is unique per organization (not per connector instance), so
 * `FieldMapping.refEntityKey` resolves to exactly one entity org-wide.
 * The partial index lets a soft-deleted key be reused by a different
 * connector. See `docs/REGION_CONFIG.c2_org_unique_entity_key.spec.md`.
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
    uniqueIndex("connector_entities_org_key_unique")
      .on(table.organizationId, table.key)
      .where(sql`deleted IS NULL`),
  ]
);
