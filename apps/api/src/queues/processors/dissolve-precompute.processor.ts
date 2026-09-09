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
 * the whole point is to pay the per-band simplify+store cost once, off the
 * request path. Each band is one `ST_SimplifyPreserveTopology` scan of the pin's
 * pipeline (no union since #532), measured ~10s/band on a 211k @ ~226-vertex
 * layer; the fine bands are the costly ones.
 */
const DISSOLVE_STATEMENT_TIMEOUT_MS = 180_000;

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
 * Precompute per-zoom-simplified polygon geometry for a pinned map (#472, #532).
 * Runs the pin's durable `pipeline` once per band and stores one row per source
 * polygon, simplified to the band tolerance and tagged with its colorBy value
 * (or the dissolve-all sentinel) — NO union (#532: it was prohibitively slow and
 * re-merged across bands). Serves low-zoom tiles as real polygons without
 * re-running the pipeline, area-ranked so a tile over the cap keeps the largest
 * by area; a miss falls back to raw-simplify at serve time. Off-request, under
 * an advisory lock on the pin so two refreshes cannot race.
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
          column_name, value, zoom_band, feature_count, geom)`;
  const rowMeta = `gen_random_uuid()::text,
              (extract(epoch from now()) * 1000)::bigint,
              'dissolve_precompute', '${organizationId}', '${portalResultId}'`;

  // #532 (unified area-ranked): one row per source polygon per band, simplified
  // to the band tolerance and tagged with its colorBy value (or the dissolve-all
  // sentinel). NO union — a colorBy choropleth and a plain polygon layer store
  // the SAME shape and differ only by the value each row carries, so the serve is
  // uniform and count-driven: a tile under the cap shows every polygon in view,
  // one over it shows the largest by area (never-drop the visible ones). Union
  // was measured 130–153s/band on a 211k @ ~226-vertex layer — prohibitive; the
  // simplify-only path is ~10s AND never re-merges across a band boundary, so it
  // is continuous by construction (same polygons, different tolerances). No
  // ST_MakeValid (measured ~66s over 211k complex polygons; ST_Simplify-
  // PreserveTopology preserves validity and ST_AsMVTGeom tolerates the rest on
  // serve). Per-band transaction: a band failure keeps its prior rows and does
  // not abort the others.
  const escapedColumn = storedColumn.replace(/'/g, "''");
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
               SELECT ${valueExpr} AS value,
                      ST_Multi(ST_CollectionExtract(ST_SimplifyPreserveTopology(src.geom, ${tol}), 3)) AS g
               FROM src WHERE src.geom IS NOT NULL
             )
             SELECT ${rowMeta},
                    '${escapedColumn}', value, ${band}, 1, g
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
