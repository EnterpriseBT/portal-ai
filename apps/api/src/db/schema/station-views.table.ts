import { pgTable, text, index, uniqueIndex } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

import { baseColumns } from "./base.columns.js";
import { organizations } from "./organizations.table.js";
import { stations } from "./stations.table.js";
import { curatedViews } from "./curated-views.table.js";

/**
 * Station view attachment (#599) — the sole data attachment for a station,
 * replacing the connector-instance attachment (`station_instances`). A
 * station's session surfaces the attached views the caller can read.
 */
export const stationViews = pgTable(
  "station_views",
  {
    ...baseColumns,
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id),
    stationId: text("station_id")
      .notNull()
      .references(() => stations.id),
    curatedViewId: text("curated_view_id")
      .notNull()
      .references(() => curatedViews.id),
  },
  (table) => [
    uniqueIndex("station_views_station_view_unique")
      .on(table.stationId, table.curatedViewId)
      .where(sql`deleted IS NULL`),
    index("station_views_station_idx")
      .on(table.stationId)
      .where(sql`deleted IS NULL`),
  ]
);
