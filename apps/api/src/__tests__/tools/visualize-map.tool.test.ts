import { describe, it, expect, jest } from "@jest/globals";

import { VisualizeMapTool } from "../../tools/visualize-map.tool.js";
import type { VisualizeMapDeps } from "../../tools/visualize-map.tool.js";

// visualize_map composes only resolveSqlDelivery (#164) — no codegen. It is
// injected via build()'s deps seam so the test drives the inline/handle
// branches without a live SQL run.

const validSpec = {
  layers: [{ kind: "points", source: { latColumn: "lat", lngColumn: "lng" } }],
};

const inlineDelivery = {
  kind: "inline" as const,
  result: {
    rows: [
      { lat: 40.7, lng: -111.9, prop_class: "vacant" },
      { lat: 40.8, lng: -111.8, prop_class: "improved" },
    ],
  },
};

const handleEnvelope = {
  queryHandle: "qh-abc",
  rowCount: 5000,
  schema: [{ name: "geom", type: "geometry" }],
  sampled: false,
  truncated: false,
  samplePeek: [{ geom: { type: "Point", coordinates: [0, 0] } }],
  sql: "SELECT geom FROM parcels",
};
const handleDelivery = { kind: "handle" as const, envelope: handleEnvelope };

type ExecArgs = {
  sql: string;
  spec: Record<string, unknown>;
  title?: string;
};

function buildTool(
  deps: VisualizeMapDeps
): (args: ExecArgs) => Promise<Record<string, unknown>> {
  const built = new VisualizeMapTool().build("station-1", "org-1", deps);
  return (args) =>
    (
      built as unknown as {
        execute: (a: ExecArgs) => Promise<Record<string, unknown>>;
      }
    ).execute(args);
}

describe("VisualizeMapTool.execute (#314)", () => {
  it("inline delivery + valid spec → geo block with inline rows + durable pipeline", async () => {
    const resolveSqlDelivery = jest.fn(async () => inlineDelivery);
    const exec = buildTool({ resolveSqlDelivery: resolveSqlDelivery as never });

    const out = await exec({
      sql: "SELECT lat, lng, prop_class FROM parcels",
      spec: validSpec,
      title: "Parcels",
    });

    expect(out).toMatchObject({ type: "geo", title: "Parcels" });
    // Delivered through the shared sink (default threshold — a higher inline
    // threshold can't be reached under the LLM SQL rowCap and would starve the
    // tile path).
    expect(resolveSqlDelivery).toHaveBeenCalledWith(
      { sql: "SELECT lat, lng, prop_class FROM parcels" },
      expect.anything()
    );
    expect(out.rows).toHaveLength(2);
    expect(out.queryHandle).toBeUndefined();
    // spec is the parsed MapSpec (defaults applied).
    expect((out.spec as { layers: unknown[] }).layers).toHaveLength(1);
    expect((out.spec as { basemap: string }).basemap).toBe("carto-light");
    expect(out.pipeline).toEqual({
      sql: "SELECT lat, lng, prop_class FROM parcels",
      stationId: "station-1",
      organizationId: "org-1",
    });
  });

  it("inline + geometryColumn source → geometry re-projected to GeoJSON; pipeline exposes `geom`", async () => {
    // The raw delivery returns geometry as WKB hex (session view exposes a raw
    // geometry type); the display query re-projects it to GeoJSON.
    const rawInline = {
      kind: "inline" as const,
      result: {
        rows: [{ c_geometry: "0101000020E6100000", c_state_name: "alpha" }],
      },
    };
    const resolveSqlDelivery = jest.fn(async () => rawInline);
    const sqlQuery = jest.fn(async () => ({
      rows: [
        {
          _row: {
            c_geometry: { type: "Point", coordinates: [-111.9, 40.7] },
            c_state_name: "alpha",
          },
        },
      ],
    }));
    const exec = buildTool({
      resolveSqlDelivery: resolveSqlDelivery as never,
      sqlQuery: sqlQuery as never,
    });

    const out = await exec({
      sql: 'SELECT "c_geometry", "c_state_name" FROM "smoke"',
      spec: {
        layers: [
          {
            kind: "points",
            source: { geometryColumn: "c_geometry" },
            style: { colorBy: { column: "c_state_name" } },
          },
        ],
      },
    });

    // Inline rows carry GeoJSON, not WKB hex.
    const rows = out.rows as Array<Record<string, unknown>>;
    expect(rows[0].c_geometry).toEqual({
      type: "Point",
      coordinates: [-111.9, 40.7],
    });
    // The display query re-projected the geometry column.
    const displaySql = (
      (sqlQuery.mock.calls[0] as unknown[])[0] as { sql: string }
    ).sql;
    expect(displaySql).toContain("ST_AsGeoJSON");
    expect(displaySql).toContain('"c_geometry"');
    // The pipeline (tiles + refresh) exposes a raw `geom` column.
    expect((out.pipeline as { sql: string }).sql).toContain("AS geom");
  });

  it("handle delivery (large result) → geo block carrying the envelope, no inline rows", async () => {
    const resolveSqlDelivery = jest.fn(async () => handleDelivery);
    const exec = buildTool({ resolveSqlDelivery: resolveSqlDelivery as never });

    const out = await exec({
      sql: "SELECT geom FROM parcels",
      spec: {
        layers: [{ kind: "polygons", source: { geometryColumn: "geom" } }],
      },
    });

    expect(out.type).toBe("geo");
    expect(out.queryHandle).toBe("qh-abc");
    expect(out.rowCount).toBe(5000);
    expect(out.rows).toBeUndefined();
    expect(out.pipeline).toMatchObject({ sql: "SELECT geom FROM parcels" });
    expect(out.title).toBeUndefined();
  });

  it("invalid spec → typed MAP_SPEC_INVALID result, and SQL is never run", async () => {
    const resolveSqlDelivery = jest.fn(async () => inlineDelivery);
    const exec = buildTool({ resolveSqlDelivery: resolveSqlDelivery as never });

    const out = await exec({
      sql: "SELECT 1",
      spec: { layers: [] }, // 0 layers — MapSpecSchema requires ≥1
    });

    expect(out.error).toMatchObject({ code: "MAP_SPEC_INVALID" });
    expect((out.error as { message: string }).message).toBeTruthy();
    // Fail fast before touching the sink.
    expect(resolveSqlDelivery).not.toHaveBeenCalled();
  });

  it("a spec referencing a column absent from the result → MAP_SPEC_INVALID (row 8)", async () => {
    const resolveSqlDelivery = jest.fn(async () => inlineDelivery);
    const exec = buildTool({ resolveSqlDelivery: resolveSqlDelivery as never });

    const out = await exec({
      sql: "SELECT lat, lng, prop_class FROM parcels",
      spec: {
        layers: [
          {
            kind: "points",
            source: { latColumn: "lat", lngColumn: "lng" },
            style: { colorBy: { column: "zoning" } }, // not in the result
          },
        ],
      },
    });

    expect(out.error).toMatchObject({ code: "MAP_SPEC_INVALID" });
    expect((out.error as { message: string }).message).toContain("zoning");
    // The sink WAS consulted (delivery is needed to know the columns).
    expect(resolveSqlDelivery).toHaveBeenCalled();
  });

  it("invalid spec — a polygons layer bound to a lat/lng source → MAP_SPEC_INVALID", async () => {
    const resolveSqlDelivery = jest.fn(async () => inlineDelivery);
    const exec = buildTool({ resolveSqlDelivery: resolveSqlDelivery as never });

    const out = await exec({
      sql: "SELECT 1",
      spec: {
        layers: [
          { kind: "polygons", source: { latColumn: "lat", lngColumn: "lng" } },
        ],
      },
    });

    expect(out.error).toMatchObject({ code: "MAP_SPEC_INVALID" });
    expect(resolveSqlDelivery).not.toHaveBeenCalled();
  });
});
