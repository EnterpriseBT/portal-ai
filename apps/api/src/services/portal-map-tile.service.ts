/**
 * Vector-tile renderer for persisted map blocks/pins (#316, slice 6).
 *
 * Reference-based and org-scoped, exactly like `widget-refresh` (#270): the
 * client supplies only a `BlockRef` + z/x/y — never SQL, a filter, or a table
 * name. The server loads the block/pin, reads its persisted pipeline SQL, and
 * runs `ST_AsMVT` over that SQL as a source subquery inside the same read-only
 * session-view transaction the SQL was authored against. The pipeline must
 * expose a raw geometry column named `geom`.
 *
 * Degradation is in-band and visible (epic *Visibility of limits*):
 *   - simplification tolerance > 0 → `simplifiedTolerance` (→ header)
 *   - per-tile feature cap clipped → `truncatedCap` (→ header)
 *   - `statement_timeout` → typed 504, not a blank tile
 */

import crypto from "crypto";

import { sql } from "drizzle-orm";
import {
  VizPipelineSchema,
  resolveAggTreatment,
  type VizPipeline,
  type MapLayerKind,
  type AggTreatment,
} from "@portalai/core/contracts";
import {
  AGG_ZOOM_THRESHOLD,
  AGG_GRID_PX,
  AGG_GRID_LEVELS,
  AGG_TILE_VERSION,
  COVERAGE_SNAP_FACTOR,
  bandForZoom,
} from "@portalai/core/constants";

import { db } from "../db/client.js";
import { ApiError } from "./http.service.js";
import { ApiCode } from "../constants/api-codes.constants.js";
import { unwrapPgError } from "../utils/pg-error.util.js";
import { PortalSqlService } from "./portal-sql.service.js";
import { portalMessagesRepo } from "../db/repositories/portal-messages.repository.js";
import { portalResultsRepo } from "../db/repositories/portal-results.repository.js";
import { createLogger } from "../utils/logger.util.js";

const logger = createLogger({ module: "portal-map-tile" });

/**
 * Max features rasterised into a single tile before clipping (limits row 3).
 * Tuned for client render weight, not just query cost: a dense polygon layer
 * (e.g. ~400k county parcels) packs 30k+ polygons into a single low-zoom tile
 * at ~100 bytes each — several such 3.5 MB tiles fetched at once stall the
 * browser. Capping at 10k keeps a low-zoom tile near ~1 MB and responsive; the
 * clip surfaces as the visible "Partial at this zoom" notice (#314), so the
 * overview is a light sample and full detail returns on zoom-in. High-zoom
 * tiles hold far fewer features than this, so they're unaffected.
 */
export const MAP_TILE_FEATURE_CAP = 10_000;
/** Statement-timeout budget for a single tile query. */
const TILE_STATEMENT_TIMEOUT_MS = 10_000;

/**
 * Map a tile-query error to a typed `504 MAP_TILE_TIMEOUT`, or `undefined` if
 * it is not a statement timeout (caller rethrows as-is). The pg `57014` code
 * arrives wrapped in Drizzle's `DrizzleQueryError`, so it must be read via
 * `unwrapPgError` (`.cause`) — reading `err.code` directly returned the timeout
 * as `500 UNKNOWN`, leaving the map blank with no explanation (#449).
 */
export function mapTileError(err: unknown): ApiError | undefined {
  if (unwrapPgError(err).code === "57014") {
    return new ApiError(
      504,
      ApiCode.MAP_TILE_TIMEOUT,
      "Map tile query timed out"
    );
  }
  return undefined;
}
/** MVT tile extent (standard 4096-unit grid). */
const TILE_EXTENT = 4096;
/** Full Web-Mercator (EPSG:3857) world width in metres; a tile's world width at
 *  zoom z is this / 2^z. Sizes the aggregation grid cells server-side (#330). */
const WORLD_3857_WIDTH = 40075016.685578488;

/**
 * Nested aggregate-grid cell size in EPSG:3857 metres at zoom `z` (#532). The
 * grid is the tile pyramid subdivided `AGG_GRID_LEVELS` more levels, so
 * `cellSize(z) = WORLD_3857_WIDTH / 2^(z + AGG_GRID_LEVELS)` — a power-of-two
 * lattice snapped to the world origin. Consecutive zooms nest exactly
 * (`cellSize(z) = 2·cellSize(z+1)`), so a bin subdivides into its four children
 * on zoom-in instead of the pre-#532 `round(512/gridSizePx)=21` lattice that
 * shared no boundaries across zoom and made bins wander/blink.
 */
export function aggregateCellSize(z: number): number {
  return WORLD_3857_WIDTH / 2 ** (z + AGG_GRID_LEVELS);
}

/**
 * Sentinel `column_name`/`value` for the no-colorBy polygon **dissolve-all**
 * flavor (#532): every polygon merged into one geometry per band. A colorBy
 * choropleth keys its rows by the real column name; a plain polygon layer keys
 * them by this sentinel, so `runDissolveTile` can serve either from the same
 * `map_dissolve_geometries` table with no schema change.
 */
export const DISSOLVE_ALL_KEY = "__all__";

/**
 * Serve-side precompute owner (#542) — a pin or a transient message block. The
 * dissolve serve keys on whichever the tile ref carries; a message ref used to
 * force `null` (→ raw path), now it serves its own coverage.
 */
export type DissolveOwner =
  | { kind: "pin"; portalResultId: string }
  | { kind: "message"; messageId: string; blockIndex: number };

/** SQL predicate scoping a `map_dissolve_geometries mdg` query to an owner. */
function dissolveOwnerCond(owner: DissolveOwner) {
  return owner.kind === "pin"
    ? sql`mdg.portal_result_id = ${owner.portalResultId}`
    : sql`mdg.message_id = ${owner.messageId} AND mdg.block_index = ${owner.blockIndex}`;
}

export type TileRef =
  | { kind: "message"; messageId: string; blockIndex: number }
  | { kind: "pin"; portalResultId: string };

export interface RenderTileParams {
  ref: TileRef;
  z: number;
  x: number;
  y: number;
  organizationId: string;
  /** `If-None-Match` request header, if any. */
  ifNoneMatch?: string;
}

export interface TileRenderResult {
  status: 200 | 204 | 304;
  /** MVT protobuf bytes; present only for a 200. */
  body?: Buffer;
  etag: string;
  /** Simplification tolerance (degrees) applied, when > 0 — else null. */
  simplifiedTolerance: number | null;
  /** The feature cap, when it clipped the tile — else null. */
  truncatedCap: number | null;
  /** Whether this tile is a low-zoom aggregate (grid bins), not raw features
   *  (#330). Mutually exclusive with `truncatedCap`/`simplifiedTolerance`. */
  aggregated: boolean;
}

/** Result of running the ST_AsMVT query. */
export interface TileQueryResult {
  mvt: Buffer | null;
  /** Features (or bins, when aggregated) rendered into the tile. */
  featureCount: number;
  /** Whether the per-tile feature cap clipped the source set. Derived from the
   *  count of rows the `LIMIT` returned — NOT `featureCount`, which drops
   *  boundary features whose clipped geometry is null and would under-report a
   *  real clip (silent truncation). Always false on the aggregate path. */
  truncated: boolean;
  /** Whether the grid-aggregation branch ran (#330). */
  aggregated: boolean;
}

export interface RenderTileDeps {
  findMessageById?: (id: string) => Promise<unknown>;
  findPortalResultById?: (id: string) => Promise<unknown>;
  runTileQuery?: (args: {
    pipeline: VizPipeline;
    propertyColumns: string[];
    organizationId: string;
    dissolveOwner: DissolveOwner | null;
    z: number;
    x: number;
    y: number;
    tolerance: number;
    cap: number;
    aggregation: TileAggregation;
    layerTotal: number | null;
    layerTotalExact: boolean;
  }) => Promise<TileQueryResult>;
}

const quoteIdentTile = (s: string) => `"${s.replace(/"/g, '""')}"`;

/**
 * Map-tile ETag format (#532): `"<a|r>~<32-hex hash>"`. The `a`/`r` prefix
 * records whether the tile aggregated, so a 304 (which runs no query) can report
 * the correct "aggregated overview" notice from the client's echoed validator.
 * The hash is what gates the 304; the prefix is carried metadata.
 */
function tileEtag(aggregated: boolean, hash: string): string {
  return `"${aggregated ? "a" : "r"}~${hash}"`;
}

/** Parse a `tileEtag`. Returns null for a malformed or pre-#532 (prefixless)
 *  validator — it then fails the 304 hash comparison and re-renders, which is
 *  the intended cache-bust across the format change. */
function parseTileEtag(
  etag: string
): { aggregated: boolean; hash: string } | null {
  const m = /^"([ar])~([0-9a-f]{32})"$/.exec(etag);
  return m ? { aggregated: m[1] === "a", hash: m[2] } : null;
}

/**
 * Property columns a geo spec needs on each tile feature — the `colorBy`
 * columns and popup-template fields. Emitted as MVT feature properties so the
 * widget can colour + fill popups client-side (without them, `["match", ["get",
 * col], …]` finds nothing → grey, and popups don't resolve). Excludes the
 * reserved geometry column `geom`. Tolerates single- or double-brace fields.
 */
export function propertyColumnsFromSpec(spec: unknown): string[] {
  const s = spec as
    | {
        layers?: Array<{ style?: { colorBy?: { column?: string } } }>;
        popup?: { template?: string };
      }
    | undefined;
  const cols = new Set<string>();
  for (const l of s?.layers ?? []) {
    const c = l.style?.colorBy?.column;
    if (typeof c === "string" && c) cols.add(c);
  }
  const tpl = s?.popup?.template;
  if (typeof tpl === "string") {
    for (const m of tpl.matchAll(/\{\{?\s*([\w.]+)\s*\}?\}/g)) cols.add(m[1]);
  }
  cols.delete("geom");
  return [...cols];
}

/**
 * Persisted layer feature count from the query-handle envelope (#532), read from
 * the block/pin content that `visualize_map` spreads the envelope onto. Prefers
 * the exact `matchedCount`; falls back to `rowCount` (exact only when the handle
 * was not `truncated`). Absent envelope ⇒ `{ null, false }` — no fast path.
 */
export function layerCountFromContent(content: Record<string, unknown>): {
  layerTotal: number | null;
  layerTotalExact: boolean;
} {
  const mc = content.matchedCount;
  if (typeof mc === "number") {
    return {
      layerTotal: mc,
      layerTotalExact: content.matchedCountExact === true,
    };
  }
  const rc = content.rowCount;
  if (typeof rc === "number") {
    return { layerTotal: rc, layerTotalExact: content.truncated === false };
  }
  return { layerTotal: null, layerTotalExact: false };
}

/** Resolved low-zoom aggregation config for a tile (#330, #337). */
export interface TileAggregation {
  enabled: boolean;
  zoomThreshold: number;
  gridSizePx: number;
  /** The colorBy column whose per-cell `mode()` colours a bin — null ⇒ density. */
  colorByColumn: string | null;
  /** Representative layer kind (#337) — drives the per-kind treatment. */
  kind: MapLayerKind | null;
  /** Resolved low-zoom treatment (#337/#472). `"dissolve"` ⇒ a polygon
   *  choropleth served from precomputed real geometry (raw-simplify on a miss),
   *  never centroid bins. */
  treatment: AggTreatment;
  /** Raw path orders by `ST_Length` DESC so a capped tile keeps the major
   *  features, not an arbitrary subset (#337). True only for line layers. */
  rankByLength: boolean;
}

/**
 * Aggregation config for a tile, read from the spec's layers (#330). The first
 * layer that declares `aggregation` supplies the knobs; the first layer with a
 * `colorBy` supplies the category column. An absent block ⇒ aggregation on with
 * the shared defaults.
 */
export function aggregationFromSpec(spec: unknown): TileAggregation {
  const layers =
    (spec as { layers?: Array<Record<string, unknown>> } | undefined)?.layers ??
    [];
  // Representative layer: the one carrying the aggregation block, else the
  // first. One pipeline = one geometry set, so its kind drives the treatment.
  const rep = layers.find((l) => l && l.aggregation) ?? layers[0];
  const agg = (rep?.aggregation ?? {}) as {
    enabled?: boolean;
    gridSizePx?: number;
    zoomThreshold?: number;
    treatment?: AggTreatment;
  };
  const kind = (rep?.kind ?? null) as MapLayerKind | null;
  let colorByColumn: string | null = null;
  for (const l of layers) {
    const c = (l?.style as { colorBy?: { column?: string } } | undefined)
      ?.colorBy?.column;
    if (typeof c === "string" && c) {
      colorByColumn = c;
      break;
    }
  }
  // Per-kind treatment (#337/#472): explicit `treatment` wins, else lines → raw,
  // #532: polygons → dissolve (real geometry, never centroid bins); lines →
  // none (raw/hybrid); points → bins. "none" routes to the raw path via
  // `enabled:false`. colorBy selects the dissolve flavor downstream, not here.
  const treatment = kind ? resolveAggTreatment(kind, agg.treatment) : "bins";
  return {
    enabled: treatment === "none" ? false : (agg.enabled ?? true),
    zoomThreshold:
      typeof agg.zoomThreshold === "number"
        ? agg.zoomThreshold
        : AGG_ZOOM_THRESHOLD,
    gridSizePx:
      typeof agg.gridSizePx === "number" ? agg.gridSizePx : AGG_GRID_PX,
    colorByColumn,
    kind,
    treatment,
    rankByLength: kind === "lines",
  };
}

/** The per-tile render mode (#532). */
export type TileMode = "raw" | "aggregate" | "hybrid-lines" | "dissolve";

/**
 * The per-tile render decision (#532) — the count-driven replacement for the
 * pre-#532 global zoom threshold. The invariant it enforces: every in-frame
 * feature is represented as itself or inside an aggregate, so raw is chosen only
 * when a tile genuinely fits under the cap.
 *
 * Order:
 *  1. A polygon choropleth with a precompute at this zoom band → `"dissolve"`
 *     (real merged geometry, never centroid bins).
 *  2. Whole-layer fast path — an *exactly*-counted layer that fits under the cap
 *     renders raw at every zoom with no per-tile probe (the #532 filed fix).
 *  3. Per-tile: the caller probes the tile's feature count (points/lines) and the
 *     count decides — `≤ cap` → raw, over → `"aggregate"` (points) or
 *     `"hybrid-lines"` (lines draw the longest `cap` + summarise the rest, never
 *     dropping a line).
 *
 * The caller (`defaultRunTileQuery`) probes for points/lines past the fast path,
 * so `tileCount` is supplied whenever it matters; the `tileCount === null`
 * interim (pre-#532 zoom threshold) is a defensive default only. An inexact/
 * truncated `layerTotal` never takes the fast path.
 */
export function resolveTileMode(args: {
  z: number;
  aggregation: TileAggregation;
  layerTotal: number | null;
  layerTotalExact: boolean;
  tileCount: number | null;
  cap: number;
  dissolveReady: boolean;
}): TileMode {
  const {
    z,
    aggregation,
    layerTotal,
    layerTotalExact,
    tileCount,
    cap,
    dissolveReady,
  } = args;

  // A dissolve (polygon choropleth) layer never renders centroid bins: it is
  // either served from precomputed real geometry, or falls back to the raw
  // (real, simplified) polygon path — the pre-#532 `treatment !== "dissolve"`
  // exclusion. Never-drop for these polygons is the dissolve precompute's job.
  if (aggregation.treatment === "dissolve") {
    return bandForZoom(z) !== null && dissolveReady ? "dissolve" : "raw";
  }

  if (layerTotalExact && layerTotal !== null && layerTotal <= cap) {
    return "raw";
  }

  if (tileCount !== null) {
    if (tileCount <= cap) return "raw";
    return aggregation.kind === "lines" ? "hybrid-lines" : "aggregate";
  }

  // Interim fallback (no per-tile probe yet): pre-#532 zoom-threshold behavior.
  const lowZoom = aggregation.enabled && z < aggregation.zoomThreshold;
  return lowZoom ? "aggregate" : "raw";
}

function notFound(): ApiError {
  return new ApiError(
    404,
    ApiCode.MAP_TILE_NOT_FOUND,
    "No renderable map tile for this reference"
  );
}

/**
 * Zoom-derived simplification tolerance in degrees ≈ one tile pixel. Zero past
 * zoom 15 (ST_AsMVGeom's own quantisation already collapses sub-pixel detail),
 * so high-zoom tiles carry no simplification notice.
 */
export function tileSimplifyTolerance(z: number): number {
  if (z >= 15) return 0;
  // World is 360° across 2^z tiles of TILE_EXTENT units each.
  return 360 / (2 ** z * TILE_EXTENT);
}

/**
 * Snap tolerance (degrees) for the polygon merged-coverage union at a band's
 * representative zoom (#541): `COVERAGE_SNAP_FACTOR ×` a tile pixel, so it is
 * always ≥ `tileSimplifyTolerance(representativeZoom)` and coarser at a coarser
 * band. Snapping the union input to this grid bounds the union cost to O(distinct
 * cells); a floor keeps it positive at the finest band (where the pixel tolerance
 * would otherwise round toward zero).
 */
export function coverageSnapTolerance(representativeZoom: number): number {
  const pixel = 360 / (2 ** representativeZoom * TILE_EXTENT);
  return pixel * COVERAGE_SNAP_FACTOR;
}

export class PortalMapTileService {
  /** Resolve a BlockRef to its durable pipeline, org-scoped (404 on any miss). */
  private static async resolvePipeline(
    ref: TileRef,
    organizationId: string,
    deps: RenderTileDeps
  ): Promise<{
    pipeline: VizPipeline;
    snapshotUpdatedAt: number | null;
    propertyColumns: string[];
    aggregation: TileAggregation;
    /** Persisted total feature count from the query envelope (#532) — drives the
     *  whole-layer fast path. Null when the content carries no count. */
    layerTotal: number | null;
    /** Whether `layerTotal` is exact (not a truncated lower bound). Only an exact
     *  count may take the fast path. */
    layerTotalExact: boolean;
  }> {
    const findMessageById =
      deps.findMessageById ?? ((id: string) => portalMessagesRepo.findById(id));
    const findPortalResultById =
      deps.findPortalResultById ??
      ((id: string) => portalResultsRepo.findById(id));

    if (ref.kind === "message") {
      const message = (await findMessageById(ref.messageId)) as Record<
        string,
        unknown
      > | null;
      // Missing OR cross-org → the same 404, no existence leak.
      if (!message || message.organizationId !== organizationId)
        throw notFound();
      const blocks = (message.blocks ?? []) as Array<Record<string, unknown>>;
      const block = blocks[ref.blockIndex];
      if (!block) throw notFound();
      const inner = (block.content ?? block) as Record<string, unknown>;
      const parsed = VizPipelineSchema.safeParse(inner.pipeline);
      if (!parsed.success) throw notFound();
      return {
        pipeline: parsed.data,
        snapshotUpdatedAt: null,
        propertyColumns: propertyColumnsFromSpec(inner.spec),
        aggregation: aggregationFromSpec(inner.spec),
        ...layerCountFromContent(inner),
      };
    }

    const row = (await findPortalResultById(ref.portalResultId)) as Record<
      string,
      unknown
    > | null;
    if (!row || row.organizationId !== organizationId) throw notFound();
    const content = (row.content ?? {}) as Record<string, unknown>;
    const parsed = VizPipelineSchema.safeParse(content.pipeline);
    if (!parsed.success) throw notFound();
    return {
      pipeline: parsed.data,
      snapshotUpdatedAt:
        typeof row.snapshotUpdatedAt === "number"
          ? row.snapshotUpdatedAt
          : null,
      propertyColumns: propertyColumnsFromSpec(content.spec),
      aggregation: aggregationFromSpec(content.spec),
      ...layerCountFromContent(content),
    };
  }

  /**
   * Raw-feature tile SQL (the pre-#330 path). `lim` is the capped,
   * tile-intersecting source set; `n_limited` counts its rows (how many the
   * LIMIT actually returned) so truncation reflects the real clip, while `n` /
   * the MVT count only the non-null clipped geometries (a boundary feature can
   * clip to null and drop out). All interpolated numbers are server-computed.
   */
  static buildRawTileSql(
    pipelineSql: string,
    envelope: string,
    propertyColumns: string[],
    tolerance: number,
    cap: number,
    rankByLength = false
  ): string {
    const geomExpr =
      tolerance > 0
        ? `ST_SimplifyPreserveTopology(src.geom, ${tolerance})`
        : "src.geom";
    // Carry the spec's property columns onto each MVT feature so the widget can
    // colour + fill popups. Names come from the validated spec and are quoted.
    const propSelect = propertyColumns
      .map((c) => `src.${quoteIdentTile(c)}, `)
      .join("");
    // #337: line layers rank by projected length so a capped tile keeps the
    // longest (major) features — a legible skeleton, never an arbitrary subset.
    const orderBy = rankByLength
      ? `ORDER BY ST_Length(ST_Transform(src.geom, 3857)) DESC `
      : ``;
    return (
      `WITH lim AS (` +
      `SELECT ${propSelect}ST_AsMVTGeom(ST_Transform(${geomExpr}, 3857), ${envelope}, ${TILE_EXTENT}, 64, true) AS geom ` +
      `FROM (${pipelineSql}) src ` +
      `WHERE src.geom && ST_Transform(${envelope}, 4326) ` +
      `${orderBy}LIMIT ${cap}` +
      `) SELECT ` +
      `(SELECT ST_AsMVT(q, 'default', ${TILE_EXTENT}, 'geom') FROM lim q WHERE q.geom IS NOT NULL) AS mvt, ` +
      `(SELECT count(*) FROM lim WHERE geom IS NOT NULL)::int AS n, ` +
      `(SELECT count(*) FROM lim)::int AS n_limited`
    );
  }

  /**
   * Low-zoom aggregate tile SQL (#330, nested grid #532). Snaps each feature's
   * centroid to a global square grid (origin 0,0 in EPSG:3857, so bins align
   * across tile seams *and* nest across zoom — see `aggregateCellSize`), groups
   * by cell, and emits one square bin per cell carrying `mode()` of the colorBy
   * column (when set) + a `_count` + `_agg:1`. Cell size is `aggregateCellSize(z)`
   * (a power-of-two subdivision of the tile pyramid), so a bin subdivides into
   * its four children on zoom-in instead of re-partitioning. The
   * fetch envelope is expanded by one cell so bins straddling a tile edge are
   * caught (and `ST_AsMVTGeom` clips the overhang). `n_limited` is 0 — the
   * aggregate summarizes rather than clips, so it never reports truncation.
   */
  static buildAggregateTileSql(
    pipelineSql: string,
    z: number,
    envelope: string,
    aggregation: TileAggregation,
    cap: number
  ): string {
    const cellSize = aggregateCellSize(z);
    const half = cellSize / 2;
    const col = aggregation.colorByColumn;
    const catAgg = col
      ? `mode() WITHIN GROUP (ORDER BY src.${quoteIdentTile(col)}) AS cat, `
      : ``;
    const catSelect = col ? `cat AS ${quoteIdentTile(col)}, ` : ``;
    return (
      `WITH cells AS (` +
      `SELECT ST_SnapToGrid(ST_Centroid(ST_Transform(src.geom, 3857)), ${cellSize}) AS cell, ` +
      `${catAgg}count(*)::int AS _count ` +
      `FROM (${pipelineSql}) src ` +
      `WHERE src.geom && ST_Transform(ST_Expand(${envelope}, ${cellSize}), 4326) ` +
      `GROUP BY 1 ` +
      `LIMIT ${cap}` +
      `) SELECT ` +
      `(SELECT ST_AsMVT(q, 'default', ${TILE_EXTENT}, 'geom') FROM (` +
      // `_agg:1` flags a bin so the client separates aggregate fills from raw
      // features by feature property (not by zoom), letting raw and aggregate
      // tiles coexist at one zoom (#532).
      `SELECT ${catSelect}_count, 1 AS _agg, ` +
      `ST_AsMVTGeom(ST_MakeEnvelope(ST_X(cell) - ${half}, ST_Y(cell) - ${half}, ST_X(cell) + ${half}, ST_Y(cell) + ${half}, 3857), ${envelope}, ${TILE_EXTENT}, 64, true) AS geom ` +
      `FROM cells` +
      `) q WHERE q.geom IS NOT NULL) AS mvt, ` +
      `(SELECT count(*) FROM cells)::int AS n, ` +
      `0 AS n_limited`
    );
  }

  /**
   * Over-cap **line** tile SQL (#532 slice 4) — a hybrid that never drops a line.
   * Ranks the lines in the envelope by projected length and draws the longest
   * `cap` as raw geometry (a legible skeleton, `_agg` unset), then summarises the
   * remainder as density bins on the same nested grid as `buildAggregateTileSql`
   * (`_agg:1` + `_count`), so the shorter lines are represented as aggregate
   * rather than clipped away. Both feature kinds share the one MVT layer; the
   * client separates them by the `_agg` property (as it already does for the
   * points aggregate). `n_limited` is 0 — a summary never reports truncation.
   */
  static buildLineHybridTileSql(
    pipelineSql: string,
    z: number,
    envelope: string,
    tolerance: number,
    cap: number
  ): string {
    const cellSize = aggregateCellSize(z);
    const half = cellSize / 2;
    const geomExpr =
      tolerance > 0 ? `ST_SimplifyPreserveTopology(r.g, ${tolerance})` : "r.g";
    return (
      `WITH ranked AS (` +
      `SELECT src.geom AS g, ` +
      `row_number() OVER (ORDER BY ST_Length(ST_Transform(src.geom, 3857)) DESC) AS rn ` +
      `FROM (${pipelineSql}) src ` +
      `WHERE src.geom && ST_Transform(${envelope}, 4326)` +
      `), ` +
      // The longest `cap` lines, drawn raw (the skeleton).
      `skeleton AS (` +
      `SELECT ST_AsMVTGeom(ST_Transform(${geomExpr}, 3857), ${envelope}, ${TILE_EXTENT}, 64, true) AS geom, ` +
      `NULL::int AS _count, 0 AS _agg ` +
      `FROM ranked r WHERE r.rn <= ${cap}` +
      `), ` +
      // The remainder, summarised to density bins on the nested grid.
      `bins AS (` +
      `SELECT ST_SnapToGrid(ST_Centroid(ST_Transform(r.g, 3857)), ${cellSize}) AS cell, count(*)::int AS _count ` +
      `FROM ranked r WHERE r.rn > ${cap} GROUP BY 1` +
      `), ` +
      `bin_geoms AS (` +
      `SELECT ST_AsMVTGeom(ST_MakeEnvelope(ST_X(cell) - ${half}, ST_Y(cell) - ${half}, ST_X(cell) + ${half}, ST_Y(cell) + ${half}, 3857), ${envelope}, ${TILE_EXTENT}, 64, true) AS geom, _count, 1 AS _agg ` +
      `FROM bins` +
      `), ` +
      `combined AS (` +
      `SELECT geom, _count, _agg FROM skeleton WHERE geom IS NOT NULL ` +
      `UNION ALL ` +
      `SELECT geom, _count, _agg FROM bin_geoms WHERE geom IS NOT NULL` +
      `) SELECT ` +
      `(SELECT ST_AsMVT(q, 'default', ${TILE_EXTENT}, 'geom') FROM combined q) AS mvt, ` +
      `(SELECT count(*) FROM combined)::int AS n, ` +
      `0 AS n_limited`
    );
  }

  /**
   * Default tile-query runner: `ST_AsMVT` over the pipeline SQL as a source
   * subquery, inside the read-only session-view transaction. Delegates SQL
   * shape to `buildRawTileSql` / `buildAggregateTileSql`; z/x/y are validated
   * integers and every other interpolant is a server-computed number.
   */
  private static async defaultRunTileQuery(args: {
    pipeline: VizPipeline;
    propertyColumns: string[];
    organizationId: string;
    dissolveOwner: DissolveOwner | null;
    z: number;
    x: number;
    y: number;
    tolerance: number;
    cap: number;
    aggregation: TileAggregation;
    layerTotal: number | null;
    layerTotalExact: boolean;
  }): Promise<TileQueryResult> {
    const {
      pipeline,
      propertyColumns,
      organizationId,
      dissolveOwner,
      z,
      x,
      y,
      tolerance,
      cap,
      aggregation,
      layerTotal,
      layerTotalExact,
    } = args;
    const envelope = `ST_TileEnvelope(${z}, ${x}, ${y})`;

    // #472/#532/#542: a low-zoom polygon map is served from precomputed dissolved
    // geometry keyed by its owner — a pin OR a message block. Its readiness feeds
    // the mode decision; a miss falls through to raw (real simplified polygons),
    // never centroid bins.
    const band = bandForZoom(z);
    // #532: a dissolve layer is a polygon layer. colorBy → per-value rows keyed
    // by the column; no colorBy → dissolve-all rows keyed by the sentinel. Both
    // serve from the same table, so the serve column is the colorBy column or
    // the sentinel — never blocked on "has a colorBy".
    const dissolveColumn = aggregation.colorByColumn ?? DISSOLVE_ALL_KEY;
    const dissolveReady =
      aggregation.treatment === "dissolve" &&
      band !== null &&
      dissolveOwner != null &&
      (await this.hasDissolvePrecompute(dissolveOwner, dissolveColumn, band));

    // Polygon dissolve is handled from the precompute, count-driven inside
    // `runDissolveTile` (individuals ≤ cap, merged coverage over).
    if (dissolveReady) {
      return this.runDissolveTile(
        dissolveOwner!,
        dissolveColumn,
        band!,
        envelope,
        cap
      );
    }

    // #532 slices 3–4: points/lines are count-driven per tile so nothing is ever
    // dropped. `resolveTileMode` owns the decision; the probe supplies the
    // per-tile count it needs. A probe is only run for a points/line layer past
    // the whole-layer fast path — a polygon with no precompute resolves to `raw`
    // (the message-map fallback, never bins) and a small/fast-path layer to `raw`
    // too, neither needing a count. The probe is the raw query at `cap + 1`:
    // cheap for points/lines (indexed envelope filter, no per-row simplify), so
    // it doubles as the raw serve for a tile that fits.
    const isPolygon = aggregation.treatment === "dissolve";
    const fitsWholeLayer =
      layerTotalExact && layerTotal !== null && layerTotal <= cap;
    const needsProbe = !isPolygon && !fitsWholeLayer;

    let probeResult: TileQueryResult | null = null;
    let tileCount: number | null = null;
    if (needsProbe) {
      const probeSql = this.buildRawTileSql(
        pipeline.sql,
        envelope,
        propertyColumns,
        tolerance,
        cap + 1,
        aggregation.rankByLength
      );
      probeResult = await this.runSessionViewTile(
        probeSql,
        pipeline.stationId,
        organizationId,
        false,
        cap + 1
      );
      // `truncated` at LIMIT cap+1 ⇒ the envelope held more than cap features.
      tileCount = probeResult.truncated ? cap + 1 : probeResult.featureCount;
    }

    const mode = resolveTileMode({
      z,
      aggregation,
      layerTotal,
      layerTotalExact,
      tileCount,
      cap,
      dissolveReady: false,
    });

    if (mode === "raw") {
      // The probe (when run) already IS the raw serve for a tile that fits.
      if (probeResult) return { ...probeResult, truncated: false };
      return this.runSessionViewTile(
        this.buildRawTileSql(
          pipeline.sql,
          envelope,
          propertyColumns,
          tolerance,
          cap,
          aggregation.rankByLength
        ),
        pipeline.stationId,
        organizationId,
        false,
        cap
      );
    }

    // Over the cap → aggregate, never clip: bins for points, and for lines a
    // hybrid of the longest `cap` drawn raw plus the remainder summarised as
    // density bins (short lines represented, never dropped).
    const aggTileSql =
      mode === "hybrid-lines"
        ? this.buildLineHybridTileSql(pipeline.sql, z, envelope, tolerance, cap)
        : this.buildAggregateTileSql(
            pipeline.sql,
            z,
            envelope,
            aggregation,
            cap
          );
    return this.runSessionViewTile(
      aggTileSql,
      pipeline.stationId,
      organizationId,
      true,
      cap
    );
  }

  /**
   * Run a tile query (raw / aggregate / hybrid SQL) inside the read-only
   * session-view transaction and shape the `TileQueryResult`. Extracted so the
   * count-driven probe and the aggregate serve share one path (#532).
   *
   * The session-view DDL is built BEFORE opening the transaction: `buildSession-
   * Views` runs its own pooled DB reads, and holding this txn's connection while
   * it does would make each concurrent tile request hold one connection and block
   * on a second — MapLibre fans out ~10 tiles at once, which would deadlock the
   * pool. Computing the DDL first keeps the txn to a single connection (#314).
   */
  private static async runSessionViewTile(
    tileSql: string,
    stationId: string,
    organizationId: string,
    aggregate: boolean,
    cap: number
  ): Promise<TileQueryResult> {
    const build = await PortalSqlService.buildSessionViews(
      stationId,
      organizationId
    );
    try {
      return await db.transaction(async (tx) => {
        await tx.execute(
          sql.raw(
            `SET LOCAL statement_timeout = '${TILE_STATEMENT_TIMEOUT_MS}ms'`
          )
        );
        for (const ddl of build.views) {
          await tx.execute(sql.raw(ddl));
        }
        await tx.execute(sql.raw("SET LOCAL transaction_read_only = on"));

        const rows = (await tx.execute(sql.raw(tileSql))) as unknown as Array<{
          mvt: Buffer | Uint8Array | null;
          n: number;
          n_limited: number;
        }>;
        const row = rows[0];
        const featureCount = row ? Number(row.n) : 0;
        const limited = row ? Number(row.n_limited) : 0;
        const raw = row?.mvt ?? null;
        const mvt = raw ? Buffer.from(raw as Uint8Array) : null;
        return {
          mvt,
          featureCount,
          // The aggregate/hybrid path summarizes rather than clips, so it never
          // truncates; the raw path is only ever served when it fits under `cap`.
          truncated: aggregate ? false : limited >= cap,
          aggregated: aggregate,
        };
      });
    } catch (err) {
      // `statement_timeout` (57014) arrives wrapped in Drizzle's
      // DrizzleQueryError, so its code is on `.cause` — reading `err.code`
      // directly missed it and the timeout escaped as 500 UNKNOWN (#449).
      const mapped = mapTileError(err);
      if (mapped) throw mapped;
      throw err;
    }
  }

  /**
   * Does a dissolve precompute exist for this pin's colorBy column at this band
   * (#472)? A cheap, envelope-independent existence check on the lookup index —
   * the signal for "serve stored geometry" vs "fall back to raw-simplify". An
   * empty tile *within* a populated pin must still serve dissolve (empty MVT),
   * so this cannot be inferred from a per-envelope count.
   */
  private static async hasDissolvePrecompute(
    owner: DissolveOwner,
    colorByColumn: string,
    band: number
  ): Promise<boolean> {
    const r = (await db.execute(sql`
      SELECT EXISTS(
        SELECT 1 FROM map_dissolve_geometries mdg
        WHERE ${dissolveOwnerCond(owner)}
          AND mdg.column_name = ${colorByColumn}
          AND mdg.zoom_band = ${band}
          AND mdg.deleted IS NULL
      ) AS e
    `)) as unknown as Array<{ e: boolean }>;
    return r[0]?.e === true;
  }

  /**
   * Serve a low-zoom tile from precomputed polygon geometry (#472, #532),
   * count-driven so it honours the never-drop invariant. Counts the **individual**
   * rows for `(pin, column, band)` in the tile envelope: at/under `cap` it serves
   * those individuals (every polygon in view rendered as itself); over `cap` it
   * serves the **merged coverage** rows instead, so every polygon is represented
   * as part of the dissolve — nothing is dropped. As a tile falls under the cap
   * on zoom-in, individuals emerge from the merged shape. A colorBy layer emits
   * its stored value as a feature property so the client's paint matches. Reads
   * `map_dissolve_geometries` directly — no pipeline SQL, no session views — and
   * the GiST index touches only rows overlapping the envelope, never the whole
   * layer.
   *
   * #541 degraded fallback: if a band has NO merged coverage (the precompute's
   * merged pass degraded or is mid-build), an over-cap tile serves area-ranked
   * individuals clipped to `cap` (flagged `truncated`) rather than serving empty.
   * The coverage-existence check is band-level, so an empty-but-covered envelope
   * still serves empty coverage, not the fallback.
   */
  private static async runDissolveTile(
    owner: DissolveOwner,
    colorByColumn: string,
    band: number,
    envelope: string,
    cap: number
  ): Promise<TileQueryResult> {
    const emitValue = colorByColumn !== DISSOLVE_ALL_KEY;
    try {
      const rows = (await db.transaction(async (tx) => {
        await tx.execute(
          sql.raw(
            `SET LOCAL statement_timeout = '${TILE_STATEMENT_TIMEOUT_MS}ms'`
          )
        );
        await tx.execute(sql.raw("SET LOCAL transaction_read_only = on"));
        const valueSelect = emitValue
          ? sql`, picked.v AS ${sql.raw(quoteIdentTile(colorByColumn))}`
          : sql``;
        const env = sql.raw(envelope);
        return (await tx.execute(sql`
          WITH cnt AS (
            SELECT count(*)::int AS n
            FROM map_dissolve_geometries mdg
            WHERE ${dissolveOwnerCond(owner)}
              AND mdg.column_name = ${colorByColumn}
              AND mdg.zoom_band = ${band}
              AND mdg.merged = false
              AND mdg.deleted IS NULL
              AND mdg.geom && ST_Transform(${env}, 4326)
          ),
          has_merged AS (
            -- band-level (envelope-independent): does this band have ANY merged
            -- coverage? If not, the merged pass degraded or is mid-build, so an
            -- over-cap tile falls back to area-ranked individuals (#541) rather
            -- than serving empty. An empty-but-covered envelope still counts as
            -- covered, so it serves empty coverage (not the fallback).
            SELECT EXISTS(
              SELECT 1 FROM map_dissolve_geometries mdg
              WHERE ${dissolveOwnerCond(owner)}
                AND mdg.column_name = ${colorByColumn}
                AND mdg.zoom_band = ${band}
                AND mdg.merged = true
                AND mdg.deleted IS NULL
            ) AS h
          ),
          individuals AS (
            -- tile at/under the cap → every polygon in view, as itself; OR a band
            -- with no merged coverage → area-ranked fallback (#541), clipped to cap
            SELECT mdg.geom AS g, mdg.value AS v
            FROM map_dissolve_geometries mdg, cnt
            WHERE (cnt.n <= ${cap} OR NOT (SELECT h FROM has_merged))
              AND ${dissolveOwnerCond(owner)}
              AND mdg.column_name = ${colorByColumn}
              AND mdg.zoom_band = ${band}
              AND mdg.merged = false
              AND mdg.deleted IS NULL
              AND mdg.geom && ST_Transform(${env}, 4326)
            ORDER BY ST_Area(mdg.geom) DESC
            LIMIT ${cap}
          ),
          coverage AS (
            -- tile over the cap AND the band has coverage → merged, nothing dropped
            SELECT mdg.geom AS g, mdg.value AS v
            FROM map_dissolve_geometries mdg, cnt
            WHERE cnt.n > ${cap}
              AND (SELECT h FROM has_merged)
              AND ${dissolveOwnerCond(owner)}
              AND mdg.column_name = ${colorByColumn}
              AND mdg.zoom_band = ${band}
              AND mdg.merged = true
              AND mdg.deleted IS NULL
              AND mdg.geom && ST_Transform(${env}, 4326)
          ),
          picked AS (
            SELECT g, v FROM individuals
            UNION ALL
            SELECT g, v FROM coverage
          ),
          lim AS (
            SELECT ST_AsMVTGeom(ST_Transform(picked.g, 3857), ${env}, ${TILE_EXTENT}, 64, true) AS geom${valueSelect}
            FROM picked
          )
          SELECT
            (SELECT ST_AsMVT(q, 'default', ${TILE_EXTENT}, 'geom')
             FROM lim q WHERE q.geom IS NOT NULL) AS mvt,
            (SELECT count(*) FROM lim WHERE geom IS NOT NULL)::int AS n,
            ((SELECT n FROM cnt) > ${cap} AND (SELECT h FROM has_merged)) AS is_merged,
            ((SELECT n FROM cnt) > ${cap} AND NOT (SELECT h FROM has_merged)) AS fell_back
        `)) as unknown as Array<{
          mvt: Buffer | Uint8Array | null;
          n: number;
          is_merged: boolean;
          fell_back: boolean;
        }>;
      })) as Array<{
        mvt: Buffer | Uint8Array | null;
        n: number;
        is_merged: boolean;
        fell_back: boolean;
      }>;
      const row = rows[0];
      const raw = row?.mvt ?? null;
      return {
        mvt: raw ? Buffer.from(raw as Uint8Array) : null,
        featureCount: row ? Number(row.n) : 0,
        // #541: an over-cap tile whose band has no merged coverage falls back to
        // area-ranked individuals clipped to the cap — a real clip (truncated), so
        // it surfaces the "Partial at this zoom" notice instead of serving blank.
        truncated: Boolean(row?.fell_back),
        // A merged-coverage tile is an aggregate overview (dissolved regions); an
        // individuals tile (under cap, or the fallback) is real per-polygon geometry.
        aggregated: Boolean(row?.is_merged),
      };
    } catch (err) {
      const mapped = mapTileError(err);
      if (mapped) throw mapped;
      throw err;
    }
  }

  static async renderTile(
    params: RenderTileParams,
    deps: RenderTileDeps = {}
  ): Promise<TileRenderResult> {
    const { ref, z, x, y, organizationId, ifNoneMatch } = params;
    const {
      pipeline,
      snapshotUpdatedAt,
      propertyColumns,
      aggregation,
      layerTotal,
      layerTotalExact,
    } = await this.resolvePipeline(ref, organizationId, deps);

    // ETag hash over (pipeline SQL, z, x, y, snapshot clock, tile-gen version).
    // A fresh pin snapshot, an edited pipeline, or a bumped AGG_TILE_VERSION
    // (tile-generation behavior change, #532) invalidates cached tiles.
    const hash = crypto
      .createHash("sha256")
      .update(
        `${pipeline.sql}|${z}|${x}|${y}|${snapshotUpdatedAt ?? ""}|${AGG_TILE_VERSION}`
      )
      .digest("hex")
      .slice(0, 32);

    const tolerance = tileSimplifyTolerance(z);

    const prior = ifNoneMatch ? parseTileEtag(ifNoneMatch) : null;
    if (prior && prior.hash === hash) {
      // No query runs on a 304 — read the aggregate flag from the client's
      // echoed validator (the tile bytes are unchanged, so the mode is too).
      return {
        status: 304,
        etag: ifNoneMatch as string,
        simplifiedTolerance:
          prior.aggregated || tolerance === 0 ? null : tolerance,
        truncatedCap: null,
        aggregated: prior.aggregated,
      };
    }

    const runTileQuery =
      deps.runTileQuery ?? this.defaultRunTileQuery.bind(this);
    const { mvt, featureCount, truncated, aggregated } = await runTileQuery({
      pipeline,
      propertyColumns,
      organizationId,
      // #542: both a pin and a message block address a dissolve precompute,
      // keyed by their owner.
      dissolveOwner:
        ref.kind === "pin"
          ? { kind: "pin", portalResultId: ref.portalResultId }
          : {
              kind: "message",
              messageId: ref.messageId,
              blockIndex: ref.blockIndex,
            },
      z,
      x,
      y,
      tolerance,
      cap: MAP_TILE_FEATURE_CAP,
      aggregation,
      layerTotal,
      layerTotalExact,
    });

    const etag = tileEtag(aggregated, hash);

    // An aggregate tile is a complete summary — it is neither "simplified"
    // (bins aren't approximations of real shapes) nor "truncated" (nothing was
    // clipped). Those notices are mutually exclusive with the aggregate one.
    const simplifiedTolerance =
      aggregated || tolerance === 0 ? null : tolerance;
    const truncatedCap = !aggregated && truncated ? MAP_TILE_FEATURE_CAP : null;

    if (truncatedCap !== null) {
      logger.warn(
        { z, x, y, cap: MAP_TILE_FEATURE_CAP },
        "Map tile clipped at the per-tile feature cap"
      );
    }

    // Genuinely empty envelope → 204 (no bytes), still carrying the ETag.
    if (!mvt || featureCount === 0) {
      return {
        status: 204,
        etag,
        simplifiedTolerance,
        truncatedCap: null,
        aggregated,
      };
    }

    return {
      status: 200,
      body: mvt,
      etag,
      simplifiedTolerance,
      truncatedCap,
      aggregated,
    };
  }
}
