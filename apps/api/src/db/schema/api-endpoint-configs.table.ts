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
 * Phase 3 widens `pagination` from `'none'` (phase 1) to the closed set
 * {'none','pageOffset','cursor','linkHeader'} via the
 * `api_endpoint_configs_pagination_check` CHECK constraint. The strategy
 * discriminator lives in the `pagination` text column; per-strategy
 * config (page size, cursor path, etc.) lives in `pagination_config`
 * jsonb. The model layer (`@portalai/core/models`)
 * exposes both as a single structured `PaginationConfig` discriminated
 * union; the route flattens to / from the table shape.
 *
 * Phase 3 also activates `headers` + `queryParams` (stored in phase 1
 * but ignored by the adapter until templating ships).
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
      "api_endpoint_configs_pagination_check",
      sql`${table.pagination} IN ('none', 'pageOffset', 'cursor', 'linkHeader')`
    ),
  ]
);
