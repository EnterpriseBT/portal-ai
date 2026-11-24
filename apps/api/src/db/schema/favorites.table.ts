import { check, index, pgTable, text, uniqueIndex } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { baseColumns } from "./base.columns.js";
import { organizations } from "./organizations.table.js";
import { users } from "./users.table.js";
import { connectorInstances } from "./connector-instances.table.js";
import { curatedViews } from "./curated-views.table.js";
import { portalResults } from "./portal-results.table.js";
import { stations } from "./stations.table.js";

/**
 * Favorites (#1072): one user's star on one station, pin
 * (`portal_results`), curated view or connector instance. Personal: only its
 * user ever reads it, and starring needs only read on the object.
 *
 * Shaped like `entity_tag_assignments`: a nullable FK per type, exactly one
 * set (`favorites_one_target`). Unlike assignments, rows are always
 * hard-deleted (on unstar, with the object, with the membership), since a
 * favorite has nothing to restore. So `deleted` stays null and the unique
 * indexes aren't partial. The target FKs cascade, so a hard delete of the
 * object takes its favorites with it.
 */
export const favorites = pgTable(
  "favorites",
  {
    ...baseColumns,
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id),
    userId: text("user_id")
      .notNull()
      .references(() => users.id),
    stationId: text("station_id").references(() => stations.id, {
      onDelete: "cascade",
    }),
    portalResultId: text("portal_result_id").references(
      () => portalResults.id,
      { onDelete: "cascade" }
    ),
    curatedViewId: text("curated_view_id").references(() => curatedViews.id, {
      onDelete: "cascade",
    }),
    connectorInstanceId: text("connector_instance_id").references(
      () => connectorInstances.id,
      { onDelete: "cascade" }
    ),
  },
  (table) => [
    check(
      "favorites_one_target",
      sql`num_nonnulls(${table.stationId}, ${table.portalResultId}, ${table.curatedViewId}, ${table.connectorInstanceId}) = 1`
    ),
    // One favorite per user per object. Target first, so an object's delete
    // sweep and a page's lookup (`<col> IN (…) AND user_id = ?`) both use it.
    uniqueIndex("favorites_station_user_unique").on(
      table.stationId,
      table.userId
    ),
    uniqueIndex("favorites_portal_result_user_unique").on(
      table.portalResultId,
      table.userId
    ),
    uniqueIndex("favorites_curated_view_user_unique").on(
      table.curatedViewId,
      table.userId
    ),
    uniqueIndex("favorites_connector_instance_user_unique").on(
      table.connectorInstanceId,
      table.userId
    ),
    // The Favorites filter and the member sweep read one user's rows in an org.
    index("favorites_org_user_idx").on(table.organizationId, table.userId),
  ]
);
