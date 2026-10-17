import {
  PINNED_CONTENT_SCHEMAS,
  PinnedDataTableContentSchema,
  PinnedD3ContentSchema,
  PinnedGeoContentSchema,
  PinDataResponseSchema,
} from "../../contracts/pinned-result.contract.js";
import { WidgetRefreshResponseSchema } from "../../contracts/portal-sql.contract.js";

// #640: a data pin stores a recipe — its query and how to draw it — never rows.

const PIPELINE = {
  sql: "SELECT a FROM t",
  stationId: "station-1",
  organizationId: "org-1",
};

describe("PINNED_CONTENT_SCHEMAS", () => {
  it("registers text, data-table, d3, and geo", () => {
    expect(PINNED_CONTENT_SCHEMAS.text).toBeDefined();
    expect(PINNED_CONTENT_SCHEMAS["data-table"]).toBeDefined();
    expect(PINNED_CONTENT_SCHEMAS.d3).toBeDefined();
    expect(PINNED_CONTENT_SCHEMAS.geo).toBeDefined();
  });

  it("text schema accepts markdown and rejects the empty string", () => {
    expect(PINNED_CONTENT_SCHEMAS.text!.safeParse("## Summary").success).toBe(
      true
    );
    expect(PINNED_CONTENT_SCHEMAS.text!.safeParse("").success).toBe(false);
    expect(PINNED_CONTENT_SCHEMAS.text!.safeParse({ body: "x" }).success).toBe(
      false
    );
  });
});

describe("PinnedDataTableContentSchema (#640)", () => {
  it("accepts columns and a query", () => {
    expect(
      PinnedDataTableContentSchema.safeParse({
        columns: ["a"],
        pipeline: PIPELINE,
      }).success
    ).toBe(true);
  });

  it("requires the query", () => {
    expect(
      PinnedDataTableContentSchema.safeParse({ columns: ["a"] }).success
    ).toBe(false);
  });

  it("refuses stored rows, counts or a handle", () => {
    for (const extra of [
      { rows: [{ a: 1 }] },
      { rowCount: 1, truncated: false },
      { queryHandle: "qh-1" },
    ]) {
      expect(
        PinnedDataTableContentSchema.safeParse({
          columns: ["a"],
          pipeline: PIPELINE,
          ...extra,
        }).success
      ).toBe(false);
    }
  });

  it("rejects a pipeline missing its sql", () => {
    expect(
      PinnedDataTableContentSchema.safeParse({
        columns: ["a"],
        pipeline: { stationId: "station-1", organizationId: "org-1" },
      }).success
    ).toBe(false);
  });
});

describe("PinnedD3ContentSchema (#640)", () => {
  it("accepts a program with its query", () => {
    expect(
      PinnedD3ContentSchema.safeParse({
        program: "api.svg.append('g');",
        pipeline: PIPELINE,
      }).success
    ).toBe(true);
  });

  it("refuses stored rows, and a program with no query", () => {
    expect(
      PinnedD3ContentSchema.safeParse({
        program: "api.svg.append('g');",
        pipeline: PIPELINE,
        rows: [{ x: 1 }],
      }).success
    ).toBe(false);
    expect(
      PinnedD3ContentSchema.safeParse({ program: "api.svg.append('g');" })
        .success
    ).toBe(false);
  });
});

describe("PinnedGeoContentSchema (#640)", () => {
  const spec = {
    layers: [{ kind: "polygons", source: { geometryColumn: "geom" } }],
  };

  it("accepts a spec with its query, keeping the #371 tiled marker", () => {
    const res = PinnedGeoContentSchema.safeParse({
      spec,
      pipeline: PIPELINE,
      tiled: true,
    });
    expect(res.success).toBe(true);
    expect((res as { data: { tiled?: boolean } }).data.tiled).toBe(true);
  });

  it("refuses stored rows", () => {
    expect(
      PinnedGeoContentSchema.safeParse({
        spec,
        pipeline: PIPELINE,
        rows: [{ geom: { type: "Point", coordinates: [0, 0] } }],
      }).success
    ).toBe(false);
  });
});

describe("PinDataResponseSchema", () => {
  it("is the widget-refresh delivery union: inline rows or a handle", () => {
    expect(PinDataResponseSchema).toBe(WidgetRefreshResponseSchema);
  });
});
