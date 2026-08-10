/**
 * Shared geo-delivery helpers (#314) used by both `visualize_map` (mint) and
 * widget-refresh (`portal-viz-refresh.service`) so a refreshed map renders
 * *identically* to the freshly-minted one. The one wrinkle a geo query has over
 * a d3 one: a raw geometry column serializes as WKB hex on the wire, which
 * MapLibre can't read — the inline path must re-project it to GeoJSON. Keeping
 * that here (rather than duplicated in the tool and the refresh service) is what
 * stops the two paths from drifting.
 */

import { AnalyticsService } from "../services/analytics.service.js";

const quoteIdent = (s: string) => `"${s.replace(/"/g, '""')}"`;
const quoteLit = (s: string) => `'${s.replace(/'/g, "''")}'`;

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
