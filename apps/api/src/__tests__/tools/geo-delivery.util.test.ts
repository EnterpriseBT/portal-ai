import { describe, it, expect } from "@jest/globals";

import {
  geoInlineRows,
  geometryColumnsFromSpec,
} from "../../tools/geo-delivery.util.js";

const ctx = { stationId: "s1", organizationId: "o1" };

type SqlQueryFn = NonNullable<Parameters<typeof geoInlineRows>[4]>["sqlQuery"];

/** A mock `sqlQuery` that records its params and returns a canned `_row` set. */
function mockSqlQuery(rows: Array<{ _row: unknown }>) {
  const calls: Array<Record<string, unknown>> = [];
  const fn = (async (params: Record<string, unknown>) => {
    calls.push(params);
    return { rows };
  }) as unknown as SqlQueryFn;
  return { fn, calls };
}

describe("geoInlineRows (#343 — inline geometry survives the reproject)", () => {
  it("bypasses the LLM cell/payload/row caps for the internal reproject query", async () => {
    const { fn, calls } = mockSqlQuery([{ _row: { geom: { type: "Point" } } }]);
    await geoInlineRows("SELECT 1", ["geom"], [{ geom: "x" }], ctx, {
      sqlQuery: fn,
    });
    expect(calls).toHaveLength(1);
    expect(calls[0].cellCap).toBe(Number.MAX_SAFE_INTEGER);
    expect(calls[0].payloadCap).toBe(Number.MAX_SAFE_INTEGER);
    expect(calls[0].rowCap).toBe(Number.MAX_SAFE_INTEGER);
  });

  it("returns the _row object as-is when the driver parses jsonb", async () => {
    const { fn } = mockSqlQuery([
      { _row: { geom: { type: "Polygon" }, a: 1 } },
    ]);
    const out = await geoInlineRows(
      "SELECT 1",
      ["geom"],
      [{ geom: "x" }],
      ctx,
      {
        sqlQuery: fn,
      }
    );
    expect(out).toEqual([{ geom: { type: "Polygon" }, a: 1 }]);
  });

  it("parses _row when it arrives as a valid JSON string", async () => {
    const { fn } = mockSqlQuery([{ _row: '{"geom":{"type":"Point"},"a":2}' }]);
    const out = await geoInlineRows(
      "SELECT 1",
      ["geom"],
      [{ geom: "x" }],
      ctx,
      {
        sqlQuery: fn,
      }
    );
    expect(out).toEqual([{ geom: { type: "Point" }, a: 2 }]);
  });

  it("degrades to {} on a non-JSON string (a truncation marker) — never throws", async () => {
    const { fn } = mockSqlQuery([{ _row: "…<truncated, original 4213b>" }]);
    const out = await geoInlineRows(
      "SELECT 1",
      ["geom"],
      [{ geom: "x" }],
      ctx,
      {
        sqlQuery: fn,
      }
    );
    expect(out).toEqual([{}]);
  });

  it("returns rawRows unchanged when there are no geometry columns", async () => {
    const { fn, calls } = mockSqlQuery([]);
    const raw = [{ a: 1 }];
    const out = await geoInlineRows("SELECT 1", [], raw, ctx, { sqlQuery: fn });
    expect(out).toBe(raw);
    expect(calls).toHaveLength(0);
  });

  it("returns rawRows unchanged when the result is empty", async () => {
    const { fn, calls } = mockSqlQuery([]);
    const out = await geoInlineRows("SELECT 1", ["geom"], [], ctx, {
      sqlQuery: fn,
    });
    expect(out).toEqual([]);
    expect(calls).toHaveLength(0);
  });
});

describe("geometryColumnsFromSpec", () => {
  it("collects geometryColumn sources, ignores lat/lng sources", () => {
    const spec = {
      layers: [
        { source: { geometryColumn: "geom" } },
        { source: { latColumn: "lat", lngColumn: "lng" } },
        { source: { geometryColumn: "boundary" } },
      ],
    };
    expect(geometryColumnsFromSpec(spec).sort()).toEqual(["boundary", "geom"]);
  });
});
