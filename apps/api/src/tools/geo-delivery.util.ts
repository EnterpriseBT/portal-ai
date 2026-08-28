/**
 * Shared geo-delivery helpers (#314) used by both `visualize_map` (mint) and
 * widget-refresh (`portal-viz-refresh.service`) so a refreshed map renders
 * *identically* to the freshly-minted one. The one wrinkle a geo query has over
 * a d3 one: a raw geometry column serializes as WKB hex on the wire, which
 * MapLibre can't read — the inline path must re-project it to GeoJSON. Keeping
 * that here (rather than duplicated in the tool and the refresh service) is what
 * stops the two paths from drifting.
 */

import { sql, type SQL } from "drizzle-orm";

import { AnalyticsService } from "../services/analytics.service.js";
import { db } from "../db/client.js";

const quoteIdent = (s: string) => `"${s.replace(/"/g, '""')}"`;
const quoteLit = (s: string) => `'${s.replace(/'/g, "''")}'`;

/** A geometry value stored as PostGIS EWKB hex, e.g. `0101000020E6100000…`. */
const WKB_HEX_RE = /^[0-9A-Fa-f]+$/;

/**
 * The reproject query is an INTERNAL render transform — its output goes to the
 * map widget, not the model's context — so the LLM-facing response caps
 * (`cellCap`/`payloadCap`/`rowCap`, meant to protect the context window) must
 * not apply. Without this, `sqlQuery`'s 500-byte `cellCap` truncates each row's
 * GeoJSON to a `…<truncated…>` marker string and the parse below throws (#343).
 * The inline path is already bounded (≤ `INLINE_ROWS_THRESHOLD` rows), so
 * lifting the caps here can't grow unbounded.
 */
const RAW_CAP = Number.MAX_SAFE_INTEGER;

/**
 * Geometry-column names a MapSpec's layers bind to. A lat/lng source is plain
 * numbers the widget turns into Points — no conversion needed — so it is not
 * listed. Tolerant of an unvalidated spec, because the refresh path reads the
 * spec straight from a persisted block (no re-parse).
 */
export function geometryColumnsFromSpec(spec: unknown): string[] {
  const layers = (
    spec as { layers?: Array<{ source?: Record<string, unknown> }> } | undefined
  )?.layers;
  const cols = new Set<string>();
  for (const l of layers ?? []) {
    const c = l?.source?.geometryColumn;
    if (typeof c === "string" && c) cols.add(c);
  }
  return [...cols];
}

/**
 * Re-project a geo query's geometry columns to GeoJSON for the inline path.
 * `rawRows` is returned unchanged when there's nothing to convert (no geometry
 * columns — e.g. a lat/lng source — or an empty result). Otherwise one small
 * display query re-runs the SQL, overriding just the geometry keys via a jsonb
 * merge so every other column rides through untouched.
 */
export async function geoInlineRows(
  sql: string,
  geometryColumns: string[],
  rawRows: Array<Record<string, unknown>>,
  ctx: { stationId: string; organizationId: string },
  deps: { sqlQuery?: typeof AnalyticsService.sqlQuery } = {}
): Promise<Array<Record<string, unknown>>> {
  if (geometryColumns.length === 0 || rawRows.length === 0) return rawRows;
  const sqlQuery =
    deps.sqlQuery ?? AnalyticsService.sqlQuery.bind(AnalyticsService);
  const overrides = geometryColumns
    .map((c) => `${quoteLit(c)}, ST_AsGeoJSON(_q.${quoteIdent(c)})::jsonb`)
    .join(", ");
  const displaySql = `SELECT to_jsonb(_q) || jsonb_build_object(${overrides}) AS _row FROM (${sql}) _q`;
  const disp = (await sqlQuery({
    sql: displaySql,
    stationId: ctx.stationId,
    organizationId: ctx.organizationId,
    // Internal reproject — never LLM-facing; keep the caps out of it (#343).
    rowCap: RAW_CAP,
    cellCap: RAW_CAP,
    payloadCap: RAW_CAP,
  })) as { rows?: Array<{ _row?: unknown }> };
  return (disp.rows ?? []).map((r) => {
    const v = r._row;
    if (typeof v === "string") {
      // The driver can hand jsonb back as text; parse it. Defensive try/catch so
      // a single unparseable cell degrades to an empty geometry rather than
      // throwing and blanking the whole map (#343).
      try {
        return JSON.parse(v) as Record<string, unknown>;
      } catch {
        return {} as Record<string, unknown>;
      }
    }
    return (v ?? {}) as Record<string, unknown>;
  });
}

/**
 * Re-encode a handle snapshot's geometry values **in place**, EWKB hex →
 * GeoJSON (#371). Unlike `geoInlineRows`, this does NOT re-run the pipeline SQL
 * — a handle-backed map is > `INLINE_ROWS_THRESHOLD` rows, so a re-run resolves
 * to a handle and never reaches the inline conversion. It converts the exact
 * rows the pin snapshot already holds (preserving count, order, and every other
 * column), fixing only the geometry column's encoding — which is the sole thing
 * that differs from a correctly-rendered inline map.
 *
 * Per geometry column, the WKB-hex values are converted in one batched query
 * (`unnest($hex[], $idx[])` → `ST_AsGeoJSON(ST_GeomFromEWKB(decode(hex,'hex')))`),
 * so there is no id-list AST overflow (#436) and no per-row round-trip. Values
 * that aren't WKB-hex strings (already-GeoJSON objects, or null) pass through
 * untouched, so the transform is idempotent and safe on already-inline pins.
 */
export async function geoReencodeRows(
  rows: Array<Record<string, unknown>>,
  geometryColumns: string[],
  deps: { execute?: (q: SQL) => Promise<unknown> } = {}
): Promise<Array<Record<string, unknown>>> {
  if (geometryColumns.length === 0 || rows.length === 0) return rows;
  const execute = deps.execute ?? ((q: SQL) => db.execute(q));
  const out = rows.map((r) => ({ ...r }));

  for (const col of geometryColumns) {
    const hexes: string[] = [];
    const idxs: number[] = [];
    out.forEach((r, i) => {
      const v = r[col];
      if (typeof v === "string" && WKB_HEX_RE.test(v)) {
        hexes.push(v);
        idxs.push(i);
      }
    });
    if (hexes.length === 0) continue;

    const res = (await execute(sql`
      SELECT t.idx AS idx,
             ST_AsGeoJSON(ST_GeomFromEWKB(decode(t.hex, 'hex')))::jsonb AS gj
      FROM unnest(${hexes}::text[], ${idxs}::int[]) AS t(hex, idx)
    `)) as unknown as Array<{ idx: number; gj: unknown }>;

    for (const { idx, gj } of res ?? []) {
      if (out[idx]) out[idx][col] = gj;
    }
  }
  return out;
}
