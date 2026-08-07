import { z } from "zod";
import { tool } from "ai";

import { MapSpecSchema } from "@portalai/core/contracts";
import { MAP_INLINE_FEATURE_THRESHOLD } from "@portalai/core/constants";

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

        // Run the agent's SQL as-authored: it decides inline-vs-handle (maps
        // inline far more generously than the 100-row table default — GeoJSON
        // features are cheap), gives the real result schema for the column
        // check, and is the durable pipeline. Geometry reads back as a raw
        // geometry type here (WKB on the wire) — required for the agent's ST_*
        // and for the tile path; the inline display re-projects it below.
        const delivery = await resolveSqlDelivery(
          { sql, inlineThreshold: MAP_INLINE_FEATURE_THRESHOLD },
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
