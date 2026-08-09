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
  D3PipelineSchema,
  resolveAggTreatment,
  type D3Pipeline,
  type MapLayerKind,
  type AggTreatment,
} from "@portalai/core/contracts";
import { AGG_ZOOM_THRESHOLD, AGG_GRID_PX } from "@portalai/core/constants";

import { db } from "../db/client.js";
import { ApiError } from "./http.service.js";
import { ApiCode } from "../constants/api-codes.constants.js";
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
/** MVT tile extent (standard 4096-unit grid). */
const TILE_EXTENT = 4096;
/** MapLibre renders vector tiles at 512 screen px by default — grid cells per
 *  tile axis derive from this and the spec's target cell px (#330). */
const TILE_SCREEN_PX = 512;
/** Full Web-Mercator (EPSG:3857) world width in metres; a tile's world width at
 *  zoom z is this / 2^z. Sizes the aggregation grid cells server-side (#330). */
const WORLD_3857_WIDTH = 40075016.685578488;

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
    pipeline: D3Pipeline;
    propertyColumns: string[];
    organizationId: string;
    z: number;
    x: number;
    y: number;
    tolerance: number;
    cap: number;
    aggregation: TileAggregation;
  }) => Promise<TileQueryResult>;
}

const quoteIdentTile = (s: string) => `"${s.replace(/"/g, '""')}"`;

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

/** Resolved low-zoom aggregation config for a tile (#330, #337). */
export interface TileAggregation {
  enabled: boolean;
  zoomThreshold: number;
  gridSizePx: number;
  /** The colorBy column whose per-cell `mode()` colours a bin — null ⇒ density. */
  colorByColumn: string | null;
  /** Representative layer kind (#337) — drives the per-kind treatment. */
  kind: MapLayerKind | null;
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
  // Per-kind treatment (#337): explicit `treatment` wins, else lines → raw,
  // others → bins. "none" routes to the raw path via `enabled:false`.
  const treatment = kind ? resolveAggTreatment(kind, agg.treatment) : "bins";
  let colorByColumn: string | null = null;
  for (const l of layers) {
    const c = (l?.style as { colorBy?: { column?: string } } | undefined)
      ?.colorBy?.column;
    if (typeof c === "string" && c) {
      colorByColumn = c;
      break;
    }
  }
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
    rankByLength: kind === "lines",
  };
}

/** Whether a tile at zoom `z` aggregates under this config. */
export function shouldAggregate(z: number, agg: TileAggregation): boolean {
  return agg.enabled && z < agg.zoomThreshold;
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

export class PortalMapTileService {
  /** Resolve a BlockRef to its durable pipeline, org-scoped (404 on any miss). */
  private static async resolvePipeline(
    ref: TileRef,
    organizationId: string,
    deps: RenderTileDeps
  ): Promise<{
    pipeline: D3Pipeline;
    snapshotUpdatedAt: number | null;
    propertyColumns: string[];
    aggregation: TileAggregation;
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
      const parsed = D3PipelineSchema.safeParse(inner.pipeline);
      if (!parsed.success) throw notFound();
      return {
        pipeline: parsed.data,
        snapshotUpdatedAt: null,
        propertyColumns: propertyColumnsFromSpec(inner.spec),
        aggregation: aggregationFromSpec(inner.spec),
      };
    }

    const row = (await findPortalResultById(ref.portalResultId)) as Record<
      string,
      unknown
    > | null;
    if (!row || row.organizationId !== organizationId) throw notFound();
    const content = (row.content ?? {}) as Record<string, unknown>;
    const parsed = D3PipelineSchema.safeParse(content.pipeline);
    if (!parsed.success) throw notFound();
    return {
      pipeline: parsed.data,
      snapshotUpdatedAt:
        typeof row.snapshotUpdatedAt === "number"
          ? row.snapshotUpdatedAt
          : null,
      propertyColumns: propertyColumnsFromSpec(content.spec),
      aggregation: aggregationFromSpec(content.spec),
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
   * Low-zoom aggregate tile SQL (#330). Snaps each feature's centroid to a
   * global square grid (origin 0,0 in EPSG:3857, so bins align across tile
   * seams), groups by cell, and emits one square bin per cell carrying
   * `mode()` of the colorBy column (when set) + a `_count`. Cell size is pinned
   * to ~`gridSizePx` screen pixels via the tile's world width at this zoom. The
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
    const cellsPerAxis = Math.max(
      1,
      Math.round(TILE_SCREEN_PX / aggregation.gridSizePx)
    );
    const cellSize = WORLD_3857_WIDTH / 2 ** z / cellsPerAxis;
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
      `SELECT ${catSelect}_count, ` +
      `ST_AsMVTGeom(ST_MakeEnvelope(ST_X(cell) - ${half}, ST_Y(cell) - ${half}, ST_X(cell) + ${half}, ST_Y(cell) + ${half}, 3857), ${envelope}, ${TILE_EXTENT}, 64, true) AS geom ` +
      `FROM cells` +
      `) q WHERE q.geom IS NOT NULL) AS mvt, ` +
      `(SELECT count(*) FROM cells)::int AS n, ` +
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
    pipeline: D3Pipeline;
    propertyColumns: string[];
    organizationId: string;
    z: number;
    x: number;
    y: number;
    tolerance: number;
    cap: number;
    aggregation: TileAggregation;
  }): Promise<TileQueryResult> {
    const {
      pipeline,
      propertyColumns,
      organizationId,
      z,
      x,
      y,
      tolerance,
      cap,
      aggregation,
    } = args;
    const envelope = `ST_TileEnvelope(${z}, ${x}, ${y})`;
    const aggregate = shouldAggregate(z, aggregation);
    const tileSql = aggregate
      ? this.buildAggregateTileSql(pipeline.sql, z, envelope, aggregation, cap)
      : this.buildRawTileSql(
          pipeline.sql,
          envelope,
          propertyColumns,
          tolerance,
          cap,
          aggregation.rankByLength
        );

    // Build the session-view DDL BEFORE opening the tile transaction.
    // `buildSessionViews` runs its own pooled DB reads (capabilities, entity +
    // column metadata); doing that while holding this txn's connection means
    // each concurrent tile request holds one connection and then blocks waiting
    // for a second — and MapLibre fans out ~10 tiles at once for any sizeable
    // layer, which deadlocks the pool (every slot held by a tile txn awaiting a
    // second connection that never frees). Computing the DDL first keeps the txn
    // to a single connection. (#314)
    const build = await PortalSqlService.buildSessionViews(
      pipeline.stationId,
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
        // The aggregate path summarizes rather than clips, so it never truncates.
        return {
          mvt,
          featureCount,
          truncated: aggregate ? false : limited >= cap,
          aggregated: aggregate,
        };
      });
    } catch (err) {
      const code = (err as { code?: string })?.code;
      if (code === "57014") {
        throw new ApiError(
          504,
          ApiCode.MAP_TILE_TIMEOUT,
          "Map tile query timed out"
        );
      }
      throw err;
    }
  }

  static async renderTile(
    params: RenderTileParams,
    deps: RenderTileDeps = {}
  ): Promise<TileRenderResult> {
    const { ref, z, x, y, organizationId, ifNoneMatch } = params;
    const { pipeline, snapshotUpdatedAt, propertyColumns, aggregation } =
      await this.resolvePipeline(ref, organizationId, deps);
    const willAggregate = shouldAggregate(z, aggregation);

    // ETag over (pipeline SQL, z, x, y, snapshot clock). A fresh pin snapshot
    // or edited pipeline invalidates cached tiles; a static one caches well.
    const etag = `"${crypto
      .createHash("sha256")
      .update(`${pipeline.sql}|${z}|${x}|${y}|${snapshotUpdatedAt ?? ""}`)
      .digest("hex")
      .slice(0, 32)}"`;

    const tolerance = tileSimplifyTolerance(z);

    if (ifNoneMatch && ifNoneMatch === etag) {
      // No query runs on a 304, so derive the aggregate flag from the config +
      // zoom (the same condition the query branches on).
      return {
        status: 304,
        etag,
        simplifiedTolerance:
          willAggregate || tolerance === 0 ? null : tolerance,
        truncatedCap: null,
        aggregated: willAggregate,
      };
    }

    const runTileQuery =
      deps.runTileQuery ?? this.defaultRunTileQuery.bind(this);
    const { mvt, featureCount, truncated, aggregated } = await runTileQuery({
      pipeline,
      propertyColumns,
      organizationId,
      z,
      x,
      y,
      tolerance,
      cap: MAP_TILE_FEATURE_CAP,
      aggregation,
    });

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
