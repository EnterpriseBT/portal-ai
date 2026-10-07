import { describe, it, expect } from "@jest/globals";

import {
  MODEL_OUTPUT_MAX_BYTES,
  toModelView,
  wrapWithModelOutputCap,
} from "../../services/model-output.util.js";

const bytes = (v: unknown) => Buffer.byteLength(JSON.stringify(v), "utf8");

/** A contour-sized polygon: ~`points` vertices of GeoJSON. */
function contour(points: number) {
  const ring = Array.from({ length: points }, (_, i) => [
    -111 + i * 1e-5,
    40 + i * 1e-5,
  ]);
  return { type: "MultiPolygon", coordinates: [[ring]] };
}

// #726: tool results reached the model verbatim; visualize_map's inline
// branch returned up to 100 full GeoJSON polygons (2.78M tokens).
describe("toModelView (#726)", () => {
  it("returns a result within the budget unchanged", () => {
    const small = { type: "data-table", rows: [{ a: 1 }, { a: 2 }] };
    expect(toModelView(small)).toBe(small);
  });

  it("projects 100 contour rows to a row count and a capped sample, keeping spec and pipeline", () => {
    const output = {
      type: "geo",
      title: "Lowest contours",
      spec: { basemap: "streets", layers: [{ kind: "polygons" }] },
      pipeline: { sql: "SELECT c_elevation, geom FROM topography" },
      rows: Array.from({ length: 100 }, (_, i) => ({
        c_elevation: i,
        geom: contour(2_000),
      })),
    };
    expect(bytes(output)).toBeGreaterThan(MODEL_OUTPUT_MAX_BYTES * 10);

    const view = toModelView(output) as Record<string, unknown>;

    expect(bytes(view)).toBeLessThanOrEqual(MODEL_OUTPUT_MAX_BYTES);
    expect(view.rows).toBeUndefined();
    expect(view.rowCount).toBe(100);
    expect(view.type).toBe("geo");
    expect(view.title).toBe("Lowest contours");
    expect(view.spec).toEqual(output.spec);
    expect(view.pipeline).toEqual(output.pipeline);
    const sample = view.samplePeek as Array<Record<string, unknown>>;
    expect(sample.length).toBeGreaterThan(0);
    expect(sample[0].c_elevation).toBe(0);
    expect(String(sample[0].geom)).toMatch(/^…<truncated, original \d+b>$/);
    expect(String(view.note)).toMatch(/user sees the full result/);
  });

  it("does not mutate the result the stream and persistence still get", () => {
    const output = {
      type: "geo",
      rows: Array.from({ length: 60 }, () => ({ geom: contour(2_000) })),
    };
    const before = JSON.stringify(output);
    toModelView(output);
    expect(JSON.stringify(output)).toBe(before);
  });

  it("truncates any other oversized result to a preview", () => {
    const output = { records: "x".repeat(MODEL_OUTPUT_MAX_BYTES * 2) };
    const view = toModelView(output) as Record<string, unknown>;
    expect(view.truncated).toBe(true);
    expect(view.originalBytes).toBe(bytes(output));
    expect(String(view.preview).length).toBe(2_000);
    expect(bytes(view)).toBeLessThanOrEqual(MODEL_OUTPUT_MAX_BYTES);
  });

  it("leaves a value JSON can't encode alone", () => {
    expect(toModelView(undefined)).toBeUndefined();
  });
});

describe("wrapWithModelOutputCap (#726)", () => {
  it("matches the SDK default within budget: a string as text, undefined as null", () => {
    const tools: Record<
      string,
      { toModelOutput?: (o: { output: unknown }) => unknown }
    > = { a: {} };
    wrapWithModelOutputCap(tools);
    expect(tools.a.toModelOutput!({ output: "ok" })).toEqual({
      type: "text",
      value: "ok",
    });
    expect(tools.a.toModelOutput!({ output: undefined })).toEqual({
      type: "json",
      value: null,
    });
    expect(tools.a.toModelOutput!({ output: { x: 1 } })).toEqual({
      type: "json",
      value: { x: 1 },
    });
  });

  it("gives every tool a toModelOutput that sends the model view", () => {
    const tools: Record<
      string,
      { toModelOutput?: (o: { output: unknown }) => unknown }
    > = {
      a: {},
      b: {},
    };
    wrapWithModelOutputCap(tools);
    const big = {
      rows: Array.from({ length: 100 }, () => ({ geom: contour(2_000) })),
    };
    for (const tool of Object.values(tools)) {
      const out = tool.toModelOutput!({ output: big }) as {
        type: string;
        value: Record<string, unknown>;
      };
      expect(out.type).toBe("json");
      expect(out.value.rowCount).toBe(100);
    }
  });
});
