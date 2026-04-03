import { pgTable, text, uniqueIndex } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { baseColumns } from "./base.columns.js";
import { stations } from "./stations.table.js";
import { connectorInstances } from "./connector-instances.table.js";

/**
 * Station instances join table.
 * Links stations to their assigned connector instances.
 */
export const stationInstances = pgTable(
  "station_instances",
  {
    ...baseColumns,
    stationId: text("station_id")
      .notNull()
      .references(() => stations.id),
    connectorInstanceId: text("connector_instance_id")
      .notNull()
      .references(() => connectorInstances.id),
  },
  (table) => [
    uniqueIndex("station_instances_station_connector_unique")
      .on(table.stationId, table.connectorInstanceId)
      .where(sql`deleted IS NULL`),
  ],
);
