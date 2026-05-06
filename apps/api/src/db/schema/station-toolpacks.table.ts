import { pgTable, text, uniqueIndex, check } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { baseColumns } from "./base.columns.js";
import { stations } from "./stations.table.js";

/**
 * Station toolpacks join table.
 *
 * One row per (station, toolpack) assignment. Phase 1 only ever
 * populates `builtin_slug`; the `organization_toolpack_id` column is
 * created nullable here so phase 2's custom-toolpacks migration is
 * purely additive (it introduces the FK target table and starts
 * inserting rows into the existing column).
 *
 * Exactly one of `builtin_slug` or `organization_toolpack_id` is
 * non-null per row, enforced by the XOR CHECK below and by the
 * `StationToolpackSchema` Zod refinement in `@portalai/core`.
 */
export const stationToolpacks = pgTable(
  "station_toolpacks",
  {
    ...baseColumns,
    stationId: text("station_id")
      .notNull()
      .references(() => stations.id),
    builtinSlug: text("builtin_slug"),
    organizationToolpackId: text("organization_toolpack_id"),
  },
  (table) => [
    // Exactly one of the two reference columns must be non-null.
    check(
      "station_toolpacks_kind_xor",
      sql`(${table.builtinSlug} IS NULL) <> (${table.organizationToolpackId} IS NULL)`
    ),
    // The same built-in slug cannot be attached to a station twice (live rows only).
    uniqueIndex("station_toolpacks_station_slug_unique")
      .on(table.stationId, table.builtinSlug)
      .where(
        sql`deleted IS NULL AND ${table.builtinSlug} IS NOT NULL`
      ),
    // The same custom toolpack cannot be attached to a station twice (live rows only).
    uniqueIndex("station_toolpacks_station_orgtp_unique")
      .on(table.stationId, table.organizationToolpackId)
      .where(
        sql`deleted IS NULL AND ${table.organizationToolpackId} IS NOT NULL`
      ),
  ]
);
