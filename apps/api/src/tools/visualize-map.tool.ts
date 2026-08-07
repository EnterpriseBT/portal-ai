import { z } from "zod";
import { tool } from "ai";

import { MapSpecSchema } from "@portalai/core/contracts";

import { Tool } from "../types/tools.js";
import { ApiCode } from "../constants/api-codes.constants.js";
import { resolveSqlDelivery as defaultResolveSqlDelivery } from "./result-sink.js";
import { AnalyticsService } from "../services/analytics.service.js";

// -- Tool input --------------------------------------------------------------
//
// Unlike `visualize_d3`, the agent authors the render spec directly: a MapSpec
// is a small closed vocabulary (the same reason the agent writes SQL), so there
// is no codegen sub-call and no model-written JS. `spec` is typed by
// `MapSpecSchema` so the agent gets the exact structure (kinds, the
// geometryColumn XOR lat/lng `source`, colorBy, popup) — a loosely-typed spec
// left the model guessing the `source` shape and every guess failed. `execute`
// still `safeParse`s defensively so a malformed spec is a typed
// `MAP_SPEC_INVALID` result the agent repairs, not a hard throw.

const InputSchema = z.object({
  sql: z
    .string()
    .describe(
      "SQL selecting the rows to map. Select the raw geometry column (aliased `geom`) when the result may be large so it can render as vector tiles; do not add a LIMIT — result size is handled automatically."
    ),
  spec: MapSpecSchema.describe(
    "The declarative map spec: an optional basemap, 1–8 layers (each a `kind` plus a `source` that is either {geometryColumn} or {latColumn,lngColumn}), optional per-layer `style` (literals or MapLibre expressions; `colorBy` drives a legend), and an optional `popup.template`."
  ),
  title: z.string().optional(),
});

/** Injectable dependencies (test seam; mirrors the DI style used elsewhere). */
export interface VisualizeMapDeps {
  resolveSqlDelivery?: typeof defaultResolveSqlDelivery;
  /** Runs the display query that re-projects geometry columns to GeoJSON for
   *  the inline path (see below). */
  sqlQuery?: typeof AnalyticsService.sqlQuery;
}

const quoteIdent = (s: string) => `"${s.replace(/"/g, '""')}"`;
const quoteLit = (s: string) => `'${s.replace(/'/g, "''")}'`;

/** Categorical palette for server-computed `colorBy` stops (Tableau 10). The
 *  widget renders the stop colours verbatim, so inline and tiled maps colour
 *  identically. */
const CATEGORICAL_PALETTE = [
  "#4e79a7",
  "#f28e2b",
  "#e15759",
  "#76b7b2",
  "#59a14f",
  "#edc948",
  "#b07aa1",
  "#ff9da7",
  "#9c755f",
  "#bab0ac",
];

/** Geometry-column names the spec's layers bind to (lat/lng sources are plain
 *  numbers the widget turns into Points — no conversion needed). */
function geometryColumns(
  spec: ReturnType<typeof MapSpecSchema.parse>
): string[] {
  return [
    ...new Set(
      spec.layers.flatMap((l) =>
        "geometryColumn" in l.source ? [l.source.geometryColumn] : []
      )
    ),
  ];
}

/** Inline rows out of a delivery result (inline path only). */
function inlineRows(
  delivery: Awaited<ReturnType<typeof defaultResolveSqlDelivery>>
): Array<Record<string, unknown>> {
  if (delivery.kind === "handle") return [];
  const result = delivery.result as {
    rows?: Array<Record<string, unknown>>;
    sample?: Array<Record<string, unknown>>;
  };
  return result.rows ?? result.sample ?? [];
}

/** The result columns a validated spec references — layer sources, colorBy,
 *  and popup-template fields. Used to reject a spec that names a column the
 *  query doesn't return (Visibility of limits, row 8) rather than render a
 *  blank layer. */
function referencedColumns(
  spec: ReturnType<typeof MapSpecSchema.parse>
): string[] {
  const cols = new Set<string>();
  for (const layer of spec.layers) {
    if ("geometryColumn" in layer.source) cols.add(layer.source.geometryColumn);
    else {
      cols.add(layer.source.latColumn);
      cols.add(layer.source.lngColumn);
    }
    if (layer.style?.colorBy) cols.add(layer.style.colorBy.column);
  }
  if (spec.popup?.template) {
    for (const m of spec.popup.template.matchAll(/\{\{\s*([\w.]+)\s*\}\}/g)) {
      cols.add(m[1]);
    }
  }
  return [...cols];
}

/** Column names a delivery exposes — the handle envelope's schema, or the
 *  first inline row's keys. Empty ⇒ unknown (skip the check). */
function schemaColumnsOf(
  delivery: Awaited<ReturnType<typeof defaultResolveSqlDelivery>>
): Set<string> {
  if (delivery.kind === "handle") {
    return new Set(delivery.envelope.schema.map((c) => c.name));
  }
  const rows = inlineRows(delivery);
  return new Set(rows.length ? Object.keys(rows[0]) : []);
}

export class VisualizeMapTool extends Tool<typeof InputSchema> {
  slug = "visualize_map";
  name = "Visualize (Map)";
  description =
    "Render an interactive map from a SQL query and a declarative MapSpec. Bind layers to result columns (a `geometry` column, or a lat/lng pair); style with literals or MapLibre expressions for per-feature colouring. Large results render as vector tiles automatically, small ones inline — do not add a LIMIT.";

  get schema() {
    return InputSchema;
  }

  build(
    stationId: string,
    organizationId: string,
    deps: VisualizeMapDeps = {}
  ) {
    const resolveSqlDelivery =
      deps.resolveSqlDelivery ?? defaultResolveSqlDelivery;
    const sqlQuery =
      deps.sqlQuery ?? AnalyticsService.sqlQuery.bind(AnalyticsService);

    return tool({
      description: this.description,
      inputSchema: this.schema,
      execute: async (input) => {
        // `spec` is MapSpecSchema-typed in the input schema (so the agent gets
        // the structure), but safeParse defensively here: a malformed spec is a
        // typed MAP_SPEC_INVALID result the agent repairs, never a hard throw or
        // partial render (Visibility of limits, row 8).
        const {
          sql,
          spec: rawSpec,
          title,
        } = input as {
          sql: string;
          spec: unknown;
          title?: string;
        };

        const specResult = MapSpecSchema.safeParse(rawSpec);
        if (!specResult.success) {
          return {
            error: {
              code: ApiCode.MAP_SPEC_INVALID,
              message: specResult.error.issues
                .map((i) => `${i.path.join(".") || "spec"}: ${i.message}`)
                .join("; "),
            },
          };
        }
        const spec = specResult.data;
        const geomCols = geometryColumns(spec);

        // Run the agent's SQL as-authored: the shared sink decides
        // inline-vs-handle (small results inline; larger stage a handle the
        // widget renders as vector tiles — the LLM SQL layer caps at
        // rowCap=500, so a higher inline threshold can never be reached and
        // would only starve the tile path). It also gives the real result
        // schema for the column check and is the durable pipeline. Geometry
        // reads back as a raw geometry type here (WKB on the wire) — required
        // for the agent's ST_* and the tile path; the inline display
        // re-projects it to GeoJSON below.
        const delivery = await resolveSqlDelivery(
          { sql },
          { stationId, organizationId }
        );

        // Reject a spec that references a column the query didn't return — a
        // typed error the agent repairs, never a blank layer (row 8).
        const columns = schemaColumnsOf(delivery);
        if (columns.size > 0) {
          const missing = referencedColumns(spec).filter(
            (c) => !columns.has(c)
          );
          if (missing.length > 0) {
            return {
              error: {
                code: ApiCode.MAP_SPEC_INVALID,
                message: `MapSpec references columns not in the query result: ${missing.join(", ")}. Available: ${[...columns].join(", ")}.`,
              },
            };
          }
        }

        // Populate `colorBy.stops` server-side so a layer coloured by category
        // renders in BOTH modes: the tile path has no inline rows for the
        // widget to derive categories from, so without stops its `match`
        // expression is empty and every feature paints the fallback colour.
        for (const layer of spec.layers) {
          const cb = layer.style?.colorBy;
          if (!cb || (cb.stops && cb.stops.length > 0)) continue;
          const distinctSql =
            `SELECT DISTINCT _q.${quoteIdent(cb.column)} AS v FROM (${sql}) _q ` +
            `WHERE _q.${quoteIdent(cb.column)} IS NOT NULL ORDER BY 1 LIMIT ${CATEGORICAL_PALETTE.length}`;
          const dres = (await sqlQuery({
            sql: distinctSql,
            stationId,
            organizationId,
          })) as { rows?: Array<{ v?: unknown }> };
          const values = (dres.rows ?? [])
            .map((r) => r.v)
            .filter(
              (v): v is string | number =>
                typeof v === "string" || typeof v === "number"
            );
          if (values.length > 0) {
            cb.stops = values.map((v, i) => [
              v,
              CATEGORICAL_PALETTE[i % CATEGORICAL_PALETTE.length],
            ]);
          }
        }

        const titleField = title ? { title } : {};
        // The tile path (#316) re-runs the pipeline SQL and needs a raw geometry
        // column named `geom`; expose it from the layer's geometry column
        // (kept under its own name too, for ST_* + refresh).
        const primaryGeom = geomCols[0];
        const pipelineSql =
          primaryGeom && primaryGeom !== "geom"
            ? `SELECT _q.*, _q.${quoteIdent(primaryGeom)} AS geom FROM (${sql}) _q`
            : sql;
        const pipeline = { sql: pipelineSql, stationId, organizationId };

        // Handle branch first — a large result rides its query-handle envelope
        // and the widget renders it through vector tiles keyed to this block.
        if (delivery.kind === "handle") {
          // A tiled map has no inline rows to fit-to client-side, so it would
          // open at [0,0]. Seed the initial view from the geometry extent when
          // the spec leaves it "fit".
          if (spec.initialView === "fit" && primaryGeom) {
            try {
              const extSql =
                `SELECT ST_XMin(e) AS xmin, ST_YMin(e) AS ymin, ST_XMax(e) AS xmax, ST_YMax(e) AS ymax ` +
                `FROM (SELECT ST_Extent(_q.${quoteIdent(primaryGeom)}::geometry) AS e FROM (${sql}) _q) x`;
              const eres = (await sqlQuery({
                sql: extSql,
                stationId,
                organizationId,
              })) as {
                rows?: Array<{
                  xmin?: number;
                  ymin?: number;
                  xmax?: number;
                  ymax?: number;
                }>;
              };
              const b = eres.rows?.[0];
              const nums = [b?.xmin, b?.ymin, b?.xmax, b?.ymax];
              if (
                b &&
                nums.every((n) => typeof n === "number" && Number.isFinite(n))
              ) {
                const span =
                  Math.max(b.xmax! - b.xmin!, b.ymax! - b.ymin!) || 0.01;
                spec.initialView = {
                  center: [(b.xmin! + b.xmax!) / 2, (b.ymin! + b.ymax!) / 2],
                  zoom: Math.max(
                    1,
                    Math.min(15, Math.floor(Math.log2(360 / span)) - 1)
                  ),
                };
              }
            } catch {
              // Leave "fit" — the widget falls back to its default view.
            }
          }
          return {
            type: "geo",
            spec,
            ...titleField,
            pipeline,
            ...delivery.envelope,
          };
        }

        // Inline: re-project the geometry column(s) to GeoJSON so the widget can
        // read them (a raw geometry serializes as WKB hex, which it can't). One
        // extra small query over the same SQL, overriding just the geometry
        // keys via jsonb merge.
        let rows = inlineRows(delivery);
        if (geomCols.length > 0) {
          const overrides = geomCols
            .map(
              (c) => `${quoteLit(c)}, ST_AsGeoJSON(_q.${quoteIdent(c)})::jsonb`
            )
            .join(", ");
          const displaySql = `SELECT to_jsonb(_q) || jsonb_build_object(${overrides}) AS _row FROM (${sql}) _q`;
          const disp = (await sqlQuery({
            sql: displaySql,
            stationId,
            organizationId,
          })) as { rows?: Array<{ _row?: unknown }> };
          rows = (disp.rows ?? []).map((r) => {
            const v = r._row;
            return (
              typeof v === "string" ? JSON.parse(v) : (v ?? {})
            ) as Record<string, unknown>;
          });
        }
        return { type: "geo", spec, ...titleField, pipeline, rows };
      },
    });
  }
}
