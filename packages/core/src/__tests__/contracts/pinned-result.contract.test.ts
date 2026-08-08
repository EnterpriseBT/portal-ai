import {
  PINNED_CONTENT_SCHEMAS,
  PinnedDataTableContentSchema,
  PinnedD3ContentSchema,
  PinRefreshResponseSchema,
} from "../../contracts/pinned-result.contract.js";
import { WidgetRefreshResponseSchema } from "../../contracts/portal-sql.contract.js";

// ── PINNED_CONTENT_SCHEMAS registry ──────────────────────────────────

describe("PINNED_CONTENT_SCHEMAS", () => {
  it("registers text, data-table, d3, and geo", () => {
    expect(PINNED_CONTENT_SCHEMAS.text).toBeDefined();
    expect(PINNED_CONTENT_SCHEMAS["data-table"]).toBeDefined();
    expect(PINNED_CONTENT_SCHEMAS.d3).toBeDefined();
    expect(PINNED_CONTENT_SCHEMAS.geo).toBeDefined();
  });

  // #312 Open Q4 resolved: the geo entry ships with #84/#314, so geo blocks
  // pin and inherit materialization + refresh. It stores the inline geo shape
  // (a handle/tile-backed map is materialized to rows at pin time).
  it("geo schema accepts the inline geo shape", () => {
    const res = PINNED_CONTENT_SCHEMAS.geo!.safeParse({
      spec: {
        layers: [
          { kind: "points", source: { latColumn: "lat", lngColumn: "lng" } },
        ],
      },
      rows: [{ lat: 40.7, lng: -111.9 }],
    });
    expect(res.success).toBe(true);
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

// ── PinnedDataTableContentSchema ─────────────────────────────────────

describe("PinnedDataTableContentSchema", () => {
  const rows = [{ a: 1 }, { a: 2 }];

  it("accepts a snapshot without a pipeline (static pin)", () => {
    const result = PinnedDataTableContentSchema.safeParse({
      columns: ["a"],
      rows,
    });
    expect(result.success).toBe(true);
  });

  it("accepts a snapshot with pipeline, rowCount, and truncated", () => {
    const result = PinnedDataTableContentSchema.safeParse({
      columns: ["a"],
      rows,
      rowCount: 120_000,
      truncated: true,
      pipeline: {
        sql: "SELECT a FROM t",
        stationId: "station-1",
        organizationId: "org-1",
      },
    });
    expect(result.success).toBe(true);
  });

  it("rejects content without materialized rows", () => {
    const result = PinnedDataTableContentSchema.safeParse({
      columns: ["a"],
      queryHandle: "qh-1",
    });
    expect(result.success).toBe(false);
  });

  it("rejects a pipeline missing its sql", () => {
    const result = PinnedDataTableContentSchema.safeParse({
      columns: ["a"],
      rows,
      pipeline: { stationId: "station-1", organizationId: "org-1" },
    });
    expect(result.success).toBe(false);
  });
});

// ── PinnedD3ContentSchema ────────────────────────────────────────────

describe("PinnedD3ContentSchema", () => {
  it("accepts the inline d3 shape (program + rows)", () => {
    const result = PinnedD3ContentSchema.safeParse({
      program: "api.svg.append('g');",
      rows: [{ x: 1 }],
      pipeline: {
        sql: "SELECT x FROM t",
        stationId: "station-1",
        organizationId: "org-1",
      },
    });
    expect(result.success).toBe(true);
  });

  it("rejects a handle-only shape (no materialized rows)", () => {
    const result = PinnedD3ContentSchema.safeParse({
      program: "api.svg.append('g');",
      queryHandle: "qh-1",
      rowCount: 3,
    });
    expect(result.success).toBe(false);
  });
});

// ── PinRefreshResponseSchema ─────────────────────────────────────────

describe("PinRefreshResponseSchema", () => {
  it("is the widget-refresh response union (one contract, two addressers)", () => {
    expect(PinRefreshResponseSchema).toBe(WidgetRefreshResponseSchema);
  });
});
