import { pgTable, text, unique } from "drizzle-orm/pg-core";
import { baseColumns } from "./base.columns.js";
import { stations } from "./stations.table.js";
import { organizationTools } from "./organization-tools.table.js";

/**
 * Station tools join table.
 * Assigns organization-level tools to specific stations.
 */
export const stationTools = pgTable(
  "station_tools",
  {
    ...baseColumns,
    stationId: text("station_id")
      .notNull()
      .references(() => stations.id),
    organizationToolId: text("organization_tool_id")
      .notNull()
      .references(() => organizationTools.id),
  },
  (table) => [
    unique("station_tools_station_tool_unique").on(
      table.stationId,
      table.organizationToolId,
    ),
  ],
);
