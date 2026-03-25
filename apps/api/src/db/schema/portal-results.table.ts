import { pgTable, text, jsonb, pgEnum } from "drizzle-orm/pg-core";
import { baseColumns } from "./base.columns.js";
import { organizations } from "./organizations.table.js";
import { stations } from "./stations.table.js";
import { portals } from "./portals.table.js";

/**
 * Portal result type enum.
 */
export const portalResultTypeEnum = pgEnum("portal_result_type", [
  "text",
  "vega-lite",
]);

/**
 * Portal results table.
 * Pinned/saved analytics results produced during portal sessions.
 */
export const portalResults = pgTable("portal_results", {
  ...baseColumns,
  organizationId: text("organization_id")
    .notNull()
    .references(() => organizations.id),
  stationId: text("station_id")
    .notNull()
    .references(() => stations.id),
  portalId: text("portal_id").references(() => portals.id),
  name: text("name").notNull(),
  type: portalResultTypeEnum("type").notNull(),
  content: jsonb("content").$type<Record<string, unknown>>().notNull(),
});
