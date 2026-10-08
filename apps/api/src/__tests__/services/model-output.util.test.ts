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

  it("leaves undefined alone", () => {
    expect(toModelView(undefined)).toBeUndefined();
  });

  // #726 (review) follow-ups.
  it("fails closed on an output that can't be serialized", () => {
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    expect(toModelView(circular)).toMatchObject({ truncated: true });
  });

  it("keeps a long program and pipeline whole when the projection fits", () => {
    const program = "p".repeat(12_000);
    const output = {
      type: "d3",
      program,
      pipeline: { sql: "s".repeat(11_000) },
      rows: Array.from({ length: 100 }, () => ({ geom: contour(2_000) })),
    };
    const view = toModelView(output) as Record<string, unknown>;
    expect(view.program).toBe(program);
    expect(view.pipeline).toEqual(output.pipeline);
    expect(view.rowCount).toBe(100);
  });

  it("treats a top-level array as rows and samples tuple rows", () => {
    const rows = Array.from({ length: 100 }, (_, i) => [i, "x".repeat(2_000)]);
    const view = toModelView(rows) as Record<string, unknown>;
    expect(view.rowCount).toBe(100);
    const sample = view.samplePeek as Array<Record<string, unknown>>;
    expect(sample.length).toBeGreaterThan(0);
    expect(sample[0]).toHaveProperty("value");
  });

  it("names the fields in the last-resort preview", () => {
    const view = toModelView({
      a: "x".repeat(60_000),
      b: "y".repeat(60_000),
    }) as Record<string, unknown>;
    expect(view.fields).toEqual(["a", "b"]);
  });
});

describe("wrapWithModelOutputCap (#726)", () => {
  it("runs a tool's own toModelOutput first and caps its JSON", async () => {
    const big = {
      rows: Array.from({ length: 100 }, () => ({ geom: contour(2_000) })),
    };
    const tools: Record<
      string,
      { toModelOutput?: (o: { output: unknown }) => unknown }
    > = {
      a: { toModelOutput: () => ({ type: "json", value: big }) },
      b: { toModelOutput: () => ({ type: "text", value: "own summary" }) },
    };
    wrapWithModelOutputCap(tools as never);
    const a = (await tools.a.toModelOutput!({ output: null })) as {
      value: Record<string, unknown>;
    };
    expect(a.value.rowCount).toBe(100);
    expect(await tools.b.toModelOutput!({ output: null })).toEqual({
      type: "text",
      value: "own summary",
    });
  });

  it("matches the SDK default within budget: a string as text, undefined as null", async () => {
    const tools: Record<
      string,
      { toModelOutput?: (o: { output: unknown }) => unknown }
    > = { a: {} };
    wrapWithModelOutputCap(tools);
    expect(await tools.a.toModelOutput!({ output: "ok" })).toEqual({
      type: "text",
      value: "ok",
    });
    expect(await tools.a.toModelOutput!({ output: undefined })).toEqual({
      type: "json",
      value: null,
    });
    expect(await tools.a.toModelOutput!({ output: { x: 1 } })).toEqual({
      type: "json",
      value: { x: 1 },
    });
  });

  it("gives every tool a toModelOutput that sends the model view", async () => {
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
      const out = (await tool.toModelOutput!({ output: big })) as {
        type: string;
        value: Record<string, unknown>;
      };
      expect(out.type).toBe("json");
      expect(out.value.rowCount).toBe(100);
    }
  });
});
