import { pgTable, text, integer, index } from "drizzle-orm/pg-core";
import { baseColumns } from "./base.columns.js";
import { organizations } from "./organizations.table.js";
import { portalResults } from "./portal-results.table.js";

/**
 * Precomputed low-zoom polygon-dissolve geometry for a pinned choropleth (#472).
 * One row = one **subdivided piece** of a dissolved region:
 * `(portalResultId, columnName, value, zoomBand)` → a bounded (≤ ~512-vertex)
 * MultiPolygon piece. The dissolved region per (value, band) is `ST_Subdivide`d
 * into many pieces so a tile clips only the pieces its envelope overlaps (via
 * the GiST index) rather than one giant geometry. Written off-request by the
 * `dissolve_precompute` job from the pin's durable `pipeline` output, read by
 * the tile serve path to render real polygons below the z14 raw handoff without
 * re-running the pipeline. Keyed by the **pin** (not an entity), so a joined /
 * aggregated multi-source choropleth is served like any other.
 *
 * There is intentionally **no unique key** — a (value, band) has many piece
 * rows. Idempotency comes from the processor's per-pin delete-then-insert in one
 * transaction, so a recompute never leaves a half-built or doubled region.
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
    /** One categorical colorBy value (text-cast) — carried onto each MVT feature. */
    value: text("value").notNull(),
    /** Index into `DISSOLVE_ZOOM_BANDS` (0..n). */
    zoomBand: integer("zoom_band").notNull(),
    /** Source polygons dissolved into this (value, band)'s region (audit). */
    featureCount: integer("feature_count").notNull(),
  },
  (t) => [
    // The serve lookup: pieces for a pin's column at a band, then geom && envelope.
    index("map_dissolve_geometries_lookup_idx").on(
      t.portalResultId,
      t.columnName,
      t.zoomBand
    ),
    index("map_dissolve_geometries_pin_idx").on(t.portalResultId),
  ]
);
