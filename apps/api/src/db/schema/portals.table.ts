import { bigint, pgTable, text } from "drizzle-orm/pg-core";
import { baseColumns } from "./base.columns.js";
import { organizations } from "./organizations.table.js";
import { stations } from "./stations.table.js";

/**
 * Portals table.
 * A chat session within a station for natural-language analytics.
 */
export const portals = pgTable("portals", {
  ...baseColumns,
  organizationId: text("organization_id")
    .notNull()
    .references(() => organizations.id),
  stationId: text("station_id")
    .notNull()
    .references(() => stations.id),
  name: text("name").notNull(),
  lastOpened: bigint("last_opened", { mode: "number" }),
});
