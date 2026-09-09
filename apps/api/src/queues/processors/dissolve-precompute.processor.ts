import { sql } from "drizzle-orm";

import { DISSOLVE_ZOOM_BANDS } from "@portalai/core/constants";
import type { DissolvePrecomputeResult } from "@portalai/core/models";

import type { TypedJobProcessor } from "../jobs.worker.js";
import { db } from "../../db/client.js";
import {
  SyncLockService,
  DISSOLVE_LOCK_NAMESPACE,
} from "../../services/sync-lock.service.js";
import { PortalSqlService } from "../../services/portal-sql.service.js";
import {
  tileSimplifyTolerance,
  DISSOLVE_ALL_KEY,
} from "../../services/portal-map-tile.service.js";
import { createLogger } from "../../utils/logger.util.js";

const logger = createLogger({ module: "dissolve-precompute" });

/**
 * Off-request statement budget for a dissolve pass (#472, #532). Far above the
 * 10s tile budget because this runs in a background job, not on a tile request —
 * the point is to pay the simplify/union cost once, off the request path. The
 * individuals scan is ~10s/band; the merged coverage's single finest `ST_Union`
 * is the expensive step (measured 130–153s on a 211k @ ~226-vertex layer), which
 * this budget must clear or the merged pass fails degraded (individuals still
 * serve). The fine bands are the costly ones.
 */
const DISSOLVE_STATEMENT_TIMEOUT_MS = 180_000;

/** Max vertices per stored **merged-coverage** piece — `ST_Subdivide` splits the
 *  dissolved region so a tile clips only the pieces its envelope overlaps (via
 *  the GiST index), never one giant multipolygon. Individuals are never
 *  subdivided (each source polygon is already small). */
const SUBDIVIDE_MAX_VERTICES = 512;

const quoteIdent = (s: string) => `"${s.replace(/"/g, '""')}"`;

type SkipReason = NonNullable<DissolvePrecomputeResult["skipped"]>;
const skip = (
  reason: SkipReason,
  columnName: string | null = null
): DissolvePrecomputeResult => ({
  columnName,
  valuesDissolved: 0,
  rowsWritten: 0,
  skipped: reason,
});

/**
 * The dissolve key for a polygon spec (#532): the first polygon layer's colorBy
 * column (per-value choropleth), or `null` when a polygon layer has no colorBy
 * (dissolve-all — one merged coverage). `skip:"non-polygon"` only when there is
 * no polygon layer at all.
 */
function resolvePolygonColorBy(
  spec: unknown
): { colorByColumn: string | null } | { skip: SkipReason } {
  const layers =
    (spec as { layers?: Array<Record<string, unknown>> } | undefined)?.layers ??
    [];
  const polys = layers.filter((l) => l?.kind === "polygons");
  if (polys.length === 0) return { skip: "non-polygon" };
  for (const l of polys) {
    const c = (l?.style as { colorBy?: { column?: string } } | undefined)
      ?.colorBy?.column;
    if (typeof c === "string" && c) return { colorByColumn: c };
  }
  return { colorByColumn: null }; // dissolve-all
}

/**
 * Precompute per-zoom polygon geometry for a pinned map (#472, #532). Runs the
 * pin's durable `pipeline` and stores TWO representations per band, tagged by
 * `merged`: individual per-polygon rows (for a tile at/under the feature cap)
 * and a dissolved coverage (for a tile over it, so nothing is dropped). Both are
 * tagged with the colorBy value (or the dissolve-all sentinel). Serves low-zoom
 * tiles as real polygons without re-running the pipeline; a miss falls back to
 * raw-simplify at serve time. Off-request, under an advisory lock on the pin so
 * two refreshes cannot race.
 */
async function runDissolve(
  portalResultId: string,
  organizationId: string
): Promise<DissolvePrecomputeResult> {
  const rows = (await db.execute(
    sql`SELECT content, station_id AS "stationId", organization_id AS "organizationId"
        FROM portal_results WHERE id = ${portalResultId} AND deleted IS NULL`
  )) as unknown as Array<{
    content: Record<string, unknown> | null;
    stationId: string;
    organizationId: string;
  }>;
  const row = rows[0];
  if (!row || row.organizationId !== organizationId) return skip("non-polygon");

  const content = (row.content ?? {}) as Record<string, unknown>;
  const spec = content.spec;
  const pipeline = content.pipeline as { sql?: string } | undefined;

  const resolved = resolvePolygonColorBy(spec);
  if ("skip" in resolved) return skip(resolved.skip);
  const { colorByColumn } = resolved;
  // colorBy → group by the real column (per-value choropleth); no colorBy →
  // group by a constant (#532 dissolve-all) and key the rows by the sentinel.
  const valueExpr = colorByColumn
    ? `(${quoteIdent(colorByColumn)})::text`
    : `'${DISSOLVE_ALL_KEY}'`;
  const storedColumn = colorByColumn ?? DISSOLVE_ALL_KEY;

  // A geo polygon pin is handle-backed and always carries a re-runnable
  // pipeline; without one there is nothing to dissolve from.
  if (!pipeline?.sql) return skip("non-polygon", colorByColumn);
  const pipelineSql = pipeline.sql;

  const build = await PortalSqlService.buildSessionViews(
    row.stationId,
    organizationId
  );
  type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
  const applyViews = async (tx: Tx) => {
    await tx.execute(
      sql.raw(
        `SET LOCAL statement_timeout = '${DISSOLVE_STATEMENT_TIMEOUT_MS}ms'`
      )
    );
    for (const ddl of build.views) await tx.execute(sql.raw(ddl));
  };

  // Geometry probe + reporting count. The area-ranked store keeps one row per
  // polygon regardless of colorBy cardinality (a high-category choropleth is no
  // longer a storage problem — it was, when each value got its own union), so
  // there is no cardinality ceiling: this pass only detects "no geometry → clear
  // and stop" and reports the distinct colorBy value count for the result.
  const distinctCount = await db.transaction(async (tx) => {
    await applyViews(tx);
    const countExpr = colorByColumn
      ? `count(DISTINCT (${quoteIdent(colorByColumn)})::text)`
      : `LEAST(count(*), 1)`;
    const r = (await tx.execute(
      sql.raw(
        `SELECT ${countExpr}::int AS n
         FROM (${pipelineSql}) src WHERE src.geom IS NOT NULL`
      )
    )) as unknown as Array<{ n: number }>;
    return r[0]?.n ?? 0;
  });

  // A pin that no longer qualifies must not keep serving stale dissolve rows.
  if (distinctCount === 0) {
    await db.execute(
      sql`DELETE FROM map_dissolve_geometries WHERE portal_result_id = ${portalResultId}`
    );
    return { columnName: colorByColumn, valuesDissolved: 0, rowsWritten: 0 };
  }

  let rowsWritten = 0;
  let degraded = false;

  const insertHead = `INSERT INTO map_dissolve_geometries
         (id, created, created_by, organization_id, portal_result_id,
          column_name, value, zoom_band, feature_count, merged, geom)`;
  const rowMeta = `gen_random_uuid()::text,
              (extract(epoch from now()) * 1000)::bigint,
              'dissolve_precompute', '${organizationId}', '${portalResultId}'`;
  const escapedColumn = storedColumn.replace(/'/g, "''");

  // #532: two representations per band, distinguished by `merged`. The serve
  // picks by per-tile feature count — individuals when ≤ cap, merged coverage
  // when over — so every polygon is represented (never-drop) AND a sparse tile
  // shows real individual shapes.

  // (A) Individuals (`merged = false`): one row per source polygon, simplified
  // to the band tolerance, tagged with its value. Per-band transaction (a band
  // failure keeps its prior rows). No union, no ST_MakeValid — ST_Simplify-
  // PreserveTopology preserves validity and ST_AsMVTGeom tolerates the rest.
  for (const { band, representativeZoom } of DISSOLVE_ZOOM_BANDS) {
    const tol = tileSimplifyTolerance(representativeZoom);
    try {
      const inserted = await db.transaction(async (tx) => {
        await applyViews(tx);
        await tx.execute(
          sql`DELETE FROM map_dissolve_geometries
              WHERE portal_result_id = ${portalResultId} AND zoom_band = ${band}
                AND merged = false`
        );
        await tx.execute(
          sql.raw(
            `${insertHead}
             WITH src AS (${pipelineSql}),
             simplified AS (
               SELECT ${valueExpr} AS value,
                      ST_Multi(ST_CollectionExtract(ST_SimplifyPreserveTopology(src.geom, ${tol}), 3)) AS g
               FROM src WHERE src.geom IS NOT NULL
             )
             SELECT ${rowMeta},
                    '${escapedColumn}', value, ${band}, 1, false, g
             FROM simplified WHERE g IS NOT NULL AND NOT ST_IsEmpty(g)`
          )
        );
        const c = (await tx.execute(
          sql`SELECT count(*)::int AS n FROM map_dissolve_geometries
              WHERE portal_result_id = ${portalResultId} AND zoom_band = ${band}
                AND merged = false`
        )) as unknown as Array<{ n: number }>;
        return c[0]?.n ?? 0;
      });
      rowsWritten += inserted;
    } catch (err) {
      degraded = true;
      logger.error(
        { event: "dissolve.band-failed", portalResultId, band, err },
        "Dissolve individuals band failed; keeping its prior rows and continuing"
      );
    }
  }

  // (B) Merged coverage (`merged = true`): the never-drop representation for a
  // tile OVER the cap. Derive-from-finest — one ST_Union per value computed ONCE
  // (the single expensive union), then each band is a topological simplification
  // + ST_Subdivide of that same geometry, so the coverage outline only smooths
  // across a boundary, never re-merges (#478). One transaction (the temp finest
  // must outlive the per-band inserts) = atomic replace of the pin's merged
  // rows. On a layer too large to union in budget this fails and is left
  // degraded — individuals still serve, and an over-cap tile falls back to the
  // area-ranked individuals (drops the smallest) rather than blanking.
  try {
    const finestTol = tileSimplifyTolerance(
      Math.max(...DISSOLVE_ZOOM_BANDS.map((b) => b.representativeZoom))
    );
    const mergedWritten = await db.transaction(async (tx) => {
      await applyViews(tx);
      await tx.execute(
        sql.raw(
          `CREATE TEMP TABLE _dissolve_finest ON COMMIT DROP AS
           WITH src AS (${pipelineSql}),
           snapped AS (
             SELECT ${valueExpr} AS value,
                    ST_CollectionExtract(ST_MakeValid(ST_SnapToGrid(src.geom, ${finestTol})), 3) AS g
             FROM src WHERE src.geom IS NOT NULL
           )
           SELECT value, ST_Union(g) AS geom, count(*)::int AS fc
           FROM snapped WHERE g IS NOT NULL AND NOT ST_IsEmpty(g)
           GROUP BY value`
        )
      );
      await tx.execute(
        sql`DELETE FROM map_dissolve_geometries
            WHERE portal_result_id = ${portalResultId} AND merged = true`
      );
      for (const { band, representativeZoom } of DISSOLVE_ZOOM_BANDS) {
        const tol = tileSimplifyTolerance(representativeZoom);
        await tx.execute(
          sql.raw(
            `${insertHead}
             WITH pieces AS (
               SELECT value, fc,
                      ST_Subdivide(ST_SimplifyPreserveTopology(geom, ${tol}), ${SUBDIVIDE_MAX_VERTICES}) AS piece
               FROM _dissolve_finest
             )
             SELECT ${rowMeta},
                    '${escapedColumn}', value, ${band}, fc, true,
                    ST_Multi(ST_CollectionExtract(piece, 3))
             FROM pieces
             WHERE piece IS NOT NULL AND NOT ST_IsEmpty(piece)
               AND ST_CollectionExtract(piece, 3) IS NOT NULL
               AND NOT ST_IsEmpty(ST_CollectionExtract(piece, 3))`
          )
        );
      }
      const c = (await tx.execute(
        sql`SELECT count(*)::int AS n FROM map_dissolve_geometries
            WHERE portal_result_id = ${portalResultId} AND merged = true`
      )) as unknown as Array<{ n: number }>;
      return c[0]?.n ?? 0;
    });
    rowsWritten += mergedWritten;
  } catch (err) {
    degraded = true;
    logger.error(
      { event: "dissolve.merged-failed", portalResultId, err },
      "Dissolve merged coverage failed; individuals kept (over-cap tiles fall back to area-ranked)"
    );
  }

  return {
    columnName: colorByColumn,
    valuesDissolved: distinctCount,
    rowsWritten,
    ...(degraded ? { degraded: true as const } : {}),
  };
}

export const dissolvePrecomputeProcessor: TypedJobProcessor<
  "dissolve_precompute"
> = async (bullJob) => {
  const { portalResultId, organizationId } = bullJob.data;
  logger.info({ portalResultId }, "dissolve_precompute started");

  const outcome = await SyncLockService.withAdvisoryLock(
    DISSOLVE_LOCK_NAMESPACE,
    portalResultId,
    () => runDissolve(portalResultId, organizationId),
    { event: "dissolve-lock", subject: "portalResultId" }
  );

  if (!outcome.acquired) {
    // Another refresh is already dissolving this pin — nothing to do.
    return {
      columnName: null,
      valuesDissolved: 0,
      rowsWritten: 0,
      skipped: "superseded",
    };
  }

  logger.info(
    { portalResultId, result: outcome.value },
    "dissolve_precompute completed"
  );
  return outcome.value;
};
