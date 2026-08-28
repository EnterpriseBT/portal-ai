import {
  pgTable,
  text,
  integer,
  uniqueIndex,
  index,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { baseColumns } from "./base.columns.js";
import { organizations } from "./organizations.table.js";
import { portalResults } from "./portal-results.table.js";

/**
 * Precomputed low-zoom polygon-dissolve geometry for a pinned choropleth (#472).
 * One row = one `(portalResultId, columnName, value, zoomBand)` → a dissolved,
 * per-zoom-simplified MultiPolygon. Written off-request by the
 * `dissolve_precompute` job from the pin's durable `pipeline` output, read by
 * the tile serve path to render real polygons below the z14 raw handoff without
 * re-running the pipeline. Keyed by the **pin** (not an entity), so a joined /
 * aggregated multi-source choropleth is served like any other.
 *
 * API-internal derived catalog — no domain model in `@portalai/core` (type-checks
 * assert the Drizzle row against its drizzle-zod schema, both directions).
 *
 * The `geom geometry(MultiPolygon,4326)` column + its GiST index are added by
 * migration DDL (Drizzle has no PostGIS type), following the wide-table
 * geometry-column pattern; it is intentionally absent here and from drizzle-zod.
 */
export const mapDissolveGeometries = pgTable(
  "map_dissolve_geometries",
  {
    ...baseColumns,
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id),
    portalResultId: text("portal_result_id")
      .notNull()
      .references(() => portalResults.id, { onDelete: "cascade" }),
    /** The pin's colorBy column as it appears on the pipeline output, e.g. `c_own_type`. */
    columnName: text("column_name").notNull(),
    /** One categorical colorBy value (text-cast). */
    value: text("value").notNull(),
    /** Index into `DISSOLVE_ZOOM_BANDS` (0..n). */
    zoomBand: integer("zoom_band").notNull(),
    /** Source polygons dissolved into this row (audit). */
    featureCount: integer("feature_count").notNull(),
  },
  (t) => [
    uniqueIndex("map_dissolve_geometries_key_unique")
      .on(t.portalResultId, t.columnName, t.value, t.zoomBand)
      .where(sql`deleted IS NULL`),
    index("map_dissolve_geometries_pin_idx").on(t.portalResultId),
  ]
);
