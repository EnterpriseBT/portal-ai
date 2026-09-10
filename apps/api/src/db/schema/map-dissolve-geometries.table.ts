import { pgTable, text, integer, boolean, index } from "drizzle-orm/pg-core";
import { baseColumns } from "./base.columns.js";
import { organizations } from "./organizations.table.js";
import { portalResults } from "./portal-results.table.js";
import { portalMessages } from "./portal-messages.table.js";

/**
 * Precomputed low-zoom polygon geometry for a map (#472, #532, #542). Written
 * off-request by the `dissolve_precompute` job from the owner's durable `pipeline`
 * output, read by the tile serve path to render real polygons below the z14 raw
 * handoff without re-running the pipeline. Keyed by its **owner** — a pin
 * (`portal_result_id`) or a transient message block (`message_id`+`block_index`),
 * exactly one set (DB CHECK), each cascade-deleting with its owner (#542) — so a
 * joined / aggregated multi-source map is served like any other.
 *
 * #532: each pin stores **two representations** per band, distinguished by
 * `merged`, so the serve can honour the never-drop invariant AND show individual
 * polygons when a tile is sparse:
 *   - `merged = false` — one row **per source polygon**, simplified to the band
 *     tolerance, tagged with its colorBy value (or the `__all__` sentinel),
 *     `featureCount = 1`. Served for a tile **at/under** the feature cap:
 *     `ORDER BY ST_Area DESC LIMIT cap` shows every polygon in view as itself.
 *   - `merged = true` — a **dissolved coverage** (one `ST_Union` per value per
 *     band, `ST_Subdivide`d into bounded pieces), `featureCount` = source count.
 *     Served for a tile **over** the cap, so every polygon is represented as part
 *     of the merge — nothing is dropped. As a tile falls under the cap on
 *     zoom-in, individuals emerge out of the merged shape (continuous).
 *
 * There is intentionally **no unique key** — a (value, band, merged) has many
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
    /** Owner (#542): a pin **or** a message block — exactly one is set (DB CHECK).
     *  Pin coverage keys on `portalResultId`; a transient message-block map keys
     *  on `(messageId, blockIndex)`. Both cascade-delete with their owner. */
    portalResultId: text("portal_result_id").references(
      () => portalResults.id,
      { onDelete: "cascade" }
    ),
    /** Message owner (#542): the `portal_messages` row a transient map block lives
     *  in; FK-cascades so message/portal deletion cleans this coverage for free. */
    messageId: text("message_id").references(() => portalMessages.id, {
      onDelete: "cascade",
    }),
    /** Which block within the owning message (#542); null for a pin owner. */
    blockIndex: integer("block_index"),
    /** The pin's colorBy column as it appears on the pipeline output, e.g. `c_own_type`. */
    columnName: text("column_name").notNull(),
    /** One categorical colorBy value (text-cast) — carried onto each MVT feature. */
    value: text("value").notNull(),
    /** Index into `DISSOLVE_ZOOM_BANDS` (0..n). */
    zoomBand: integer("zoom_band").notNull(),
    /** Source polygons dissolved into this row (1 for an individual, the merged
     *  source count for a coverage row). */
    featureCount: integer("feature_count").notNull(),
    /** `false` = one individual source polygon; `true` = a dissolved coverage
     *  piece (#532). The serve picks the representation by per-tile feature count. */
    merged: boolean("merged").notNull().default(false),
  },
  (t) => [
    // The serve lookup: rows for a pin's column at a band + representation, then
    // geom && envelope.
    index("map_dissolve_geometries_lookup_idx").on(
      t.portalResultId,
      t.columnName,
      t.zoomBand,
      t.merged
    ),
    index("map_dissolve_geometries_pin_idx").on(t.portalResultId),
    // The message-owner serve lookup (#542), mirroring the pin lookup.
    index("map_dissolve_geometries_message_lookup_idx").on(
      t.messageId,
      t.blockIndex,
      t.columnName,
      t.zoomBand,
      t.merged
    ),
  ]
);
