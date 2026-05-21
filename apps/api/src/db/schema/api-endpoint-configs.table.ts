import { pgTable, text, jsonb, uniqueIndex, check } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { baseColumns } from "./base.columns.js";
import { organizations } from "./organizations.table.js";
import { connectorEntities } from "./connector-entities.table.js";

/**
 * Per-entity endpoint configuration for the REST API connector.
 * One row per connector_entity whose owning connector_instance points
 * at a `rest-api` connector definition.
 *
 * Phase 1 hard-codes `pagination = 'none'` via the CHECK constraint;
 * phase 3 widens the allowed values to ('none', 'pageOffset', 'cursor',
 * 'linkHeader') and starts populating `pagination_config` + `body_template`.
 *
 * `headers` + `queryParams` are stored in phase 1 but ignored by the
 * adapter; templating wires them in during phase 3.
 */
export const apiEndpointConfigs = pgTable(
  "api_endpoint_configs",
  {
    ...baseColumns,
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id),
    connectorEntityId: text("connector_entity_id")
      .notNull()
      .references(() => connectorEntities.id),
    path: text("path").notNull(),
    method: text("method").notNull(),
    headers: jsonb("headers").$type<Record<string, string>>(),
    queryParams: jsonb("query_params").$type<Record<string, string>>(),
    bodyTemplate: text("body_template"),
    pagination: text("pagination").notNull(),
    paginationConfig: jsonb("pagination_config").$type<Record<string, unknown>>(),
    recordsPath: text("records_path").notNull().default(""),
    idField: text("id_field"),
  },
  (table) => [
    uniqueIndex("api_endpoint_configs_entity_unique")
      .on(table.connectorEntityId)
      .where(sql`deleted IS NULL`),
    check(
      "api_endpoint_configs_method_check",
      sql`${table.method} IN ('GET', 'POST')`
    ),
    check(
      "api_endpoint_configs_pagination_phase1_check",
      sql`${table.pagination} = 'none'`
    ),
  ]
);
