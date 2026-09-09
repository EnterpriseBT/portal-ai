import { sql } from "drizzle-orm";

import {
  DISSOLVE_ZOOM_BANDS,
  DISSOLVE_CARDINALITY_CEILING,
} from "@portalai/core/constants";
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
 * Off-request statement budget for a dissolve pass (#472). Far above the 10s
 * tile budget because this runs in a background job, not on a tile request —
 * the whole point is to pay the union cost once, off the request path. Measured
 * on a 397,960-parcel layer: ~2s / ~21s / ~30s for the three bands.
 */
const DISSOLVE_STATEMENT_TIMEOUT_MS = 180_000;

/** Max vertices per stored piece — `ST_Subdivide` splits the dissolved region so
 *  a tile clips only the pieces its envelope overlaps (via the GiST index),
 *  never one giant multipolygon. */
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
 * Precompute the dissolved, per-zoom-simplified polygon geometry for a pinned
 * choropleth (#472). Runs the pin's durable `pipeline` once per band, dissolves
 * the result by the colorBy value (snap-to-grid → make-valid → union), and
 * subdivides it into bounded pieces stored keyed by the pin. Serves low-zoom
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

  // Cardinality gate — a choropleth with more categories than the ceiling isn't
  // legible and isn't worth dissolving; the serve path falls back to raw-simplify.
  // Dissolve-all (no colorBy) has one implicit value, so its "cardinality" is
  // just "has any geometry" (1) — the ceiling never applies.
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
  const clearExisting = () =>
    db.execute(
      sql`DELETE FROM map_dissolve_geometries WHERE portal_result_id = ${portalResultId}`
    );

  if (distinctCount === 0) {
    await clearExisting();
    return { columnName: colorByColumn, valuesDissolved: 0, rowsWritten: 0 };
  }
  if (distinctCount > DISSOLVE_CARDINALITY_CEILING) {
    await clearExisting();
    return skip("over-cardinality", colorByColumn);
  }

  let rowsWritten = 0;
  let degraded = false;

  const insertHead = `INSERT INTO map_dissolve_geometries
         (id, created, created_by, organization_id, portal_result_id,
          column_name, value, zoom_band, feature_count, geom)`;
  const rowMeta = `gen_random_uuid()::text,
              (extract(epoch from now()) * 1000)::bigint,
              'dissolve_precompute', '${organizationId}', '${portalResultId}'`;

  if (colorByColumn) {
    // colorBy choropleth — #478 derive-from-finest (slice 6): compute the finest
    // union per value ONCE (the one expensive union), then each band is a
    // topological *simplification* of that same geometry, so a region's outline
    // only smooths across a band boundary, never re-merges differently. One
    // transaction (the temp finest must outlive the per-band inserts) = an
    // atomic replace of the whole pin's rows, no zero-row window.
    const finestTol = tileSimplifyTolerance(
      Math.max(...DISSOLVE_ZOOM_BANDS.map((b) => b.representativeZoom))
    );
    rowsWritten = await db.transaction(async (tx) => {
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
        sql`DELETE FROM map_dissolve_geometries WHERE portal_result_id = ${portalResultId}`
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
                    '${storedColumn.replace(/'/g, "''")}', value, ${band}, fc,
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
            WHERE portal_result_id = ${portalResultId}`
      )) as unknown as Array<{ n: number }>;
      return c[0]?.n ?? 0;
    });
  } else {
    // #532 no-colorBy → area-ranked simplified geometry, NO union: one row per
    // polygon, simplified to the band tolerance (union measured 130–153s/band on
    // a 211k @ ~226-vertex layer — prohibitive; simplify-only ~10s). Already
    // continuous across bands (same polygons, different tolerances), so it keeps
    // the per-band transaction (atomic replace of one band; a band failure keeps
    // its prior rows and does not abort the others).
    for (const { band, representativeZoom } of DISSOLVE_ZOOM_BANDS) {
      const tol = tileSimplifyTolerance(representativeZoom);
      try {
        const inserted = await db.transaction(async (tx) => {
          await applyViews(tx);
          await tx.execute(
            sql`DELETE FROM map_dissolve_geometries
                WHERE portal_result_id = ${portalResultId} AND zoom_band = ${band}`
          );
          await tx.execute(
            sql.raw(
              `${insertHead}
               WITH src AS (${pipelineSql}),
               simplified AS (
                 -- No ST_MakeValid: measured ~66s over 211k complex polygons;
                 -- ST_SimplifyPreserveTopology preserves validity, ST_AsMVTGeom
                 -- tolerates the rest on serve.
                 SELECT ST_Multi(ST_CollectionExtract(ST_SimplifyPreserveTopology(src.geom, ${tol}), 3)) AS g
                 FROM src WHERE src.geom IS NOT NULL
               )
               SELECT ${rowMeta},
                      '${DISSOLVE_ALL_KEY}', '${DISSOLVE_ALL_KEY}', ${band}, 1, g
               FROM simplified WHERE g IS NOT NULL AND NOT ST_IsEmpty(g)`
            )
          );
          const c = (await tx.execute(
            sql`SELECT count(*)::int AS n FROM map_dissolve_geometries
                WHERE portal_result_id = ${portalResultId} AND zoom_band = ${band}`
          )) as unknown as Array<{ n: number }>;
          return c[0]?.n ?? 0;
        });
        rowsWritten += inserted;
      } catch (err) {
        degraded = true;
        logger.error(
          { event: "dissolve.band-failed", portalResultId, band, err },
          "Dissolve band failed; keeping its prior rows and continuing"
        );
      }
    }
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
