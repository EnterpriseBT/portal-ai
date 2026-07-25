import {
  D3BlockContentSchema,
  D3HandleContentSchema,
  D3InlineContentSchema,
  D3PipelineSchema,
} from "../../contracts/d3-widget.contract.js";
import {
  D3BlockContentSchema as BarrelD3BlockContentSchema,
  QueryHandleEnvelopeFieldsSchema as BarrelEnvelopeFieldsSchema,
} from "../../contracts/index.js";

// ── Fixtures ─────────────────────────────────────────────────────────

const PROGRAM = "api.d3.select(api.container).append('svg');";

const inlineContent = {
  program: PROGRAM,
  rows: [
    { month: "Jan", total: 12 },
    { month: "Feb", total: 19 },
  ],
};

const envelopeFields = {
  queryHandle: "qh-d3-abc",
  rowCount: 13_427,
  schema: [
    { name: "month", type: "text" },
    { name: "total", type: "numeric" },
  ],
  sampled: false,
  truncated: false,
  samplePeek: [{ month: "Jan", total: 12 }],
  sql: "SELECT month, total FROM sales",
};

const handleContent = { program: PROGRAM, ...envelopeFields };

const pipeline = {
  sql: "SELECT month, total FROM sales",
  stationId: "st-1",
  organizationId: "org-1",
};

// ── D3InlineContentSchema ────────────────────────────────────────────

describe("D3InlineContentSchema", () => {
  it("parses program + inline rows", () => {
    const parsed = D3InlineContentSchema.parse(inlineContent);
    expect(parsed.program).toBe(PROGRAM);
    expect(parsed.rows).toHaveLength(2);
  });

  it("accepts optional title and params", () => {
    const parsed = D3InlineContentSchema.parse({
      ...inlineContent,
      title: "Monthly totals",
      params: { highlight: "Feb", threshold: 15 },
    });
    expect(parsed.title).toBe("Monthly totals");
    expect(parsed.params).toEqual({ highlight: "Feb", threshold: 15 });
  });

  it("rejects a missing program", () => {
    const { program: _program, ...rest } = inlineContent;
    expect(D3InlineContentSchema.safeParse(rest).success).toBe(false);
  });

  it("rejects an empty program", () => {
    expect(
      D3InlineContentSchema.safeParse({ ...inlineContent, program: "" }).success
    ).toBe(false);
  });

  it("rejects missing rows", () => {
    expect(D3InlineContentSchema.safeParse({ program: PROGRAM }).success).toBe(
      false
    );
  });
});

// ── D3HandleContentSchema ────────────────────────────────────────────

describe("D3HandleContentSchema", () => {
  it("parses program + the full query-handle envelope fields", () => {
    const parsed = D3HandleContentSchema.parse(handleContent);
    expect(parsed.program).toBe(PROGRAM);
    expect(parsed.queryHandle).toBe("qh-d3-abc");
    expect(parsed.rowCount).toBe(13_427);
    expect(parsed.sql).toBe("SELECT month, total FROM sales");
  });

  it("rejects a missing envelope field (rowCount)", () => {
    const { rowCount: _rowCount, ...rest } = handleContent;
    expect(D3HandleContentSchema.safeParse(rest).success).toBe(false);
  });

  it("rejects a missing program", () => {
    const { program: _program, ...rest } = handleContent;
    expect(D3HandleContentSchema.safeParse(rest).success).toBe(false);
  });
});

// ── D3BlockContentSchema (union) ─────────────────────────────────────

describe("D3BlockContentSchema", () => {
  it("resolves handle-shaped content to the handle branch", () => {
    const parsed = D3BlockContentSchema.parse(handleContent);
    expect("queryHandle" in parsed && parsed.queryHandle).toBe("qh-d3-abc");
  });

  it("resolves rows-shaped content to the inline branch", () => {
    const parsed = D3BlockContentSchema.parse(inlineContent);
    expect("rows" in parsed && parsed.rows).toHaveLength(2);
  });

  it("rejects content with neither rows nor a queryHandle envelope", () => {
    expect(
      D3BlockContentSchema.safeParse({ program: PROGRAM, title: "x" }).success
    ).toBe(false);
  });
});

// ── D3PipelineSchema + durable pipeline field (#270) ─────────────────

describe("D3PipelineSchema (#270)", () => {
  it("parses a full pipeline", () => {
    const parsed = D3PipelineSchema.parse(pipeline);
    expect(parsed.sql).toBe("SELECT month, total FROM sales");
    expect(parsed.stationId).toBe("st-1");
    expect(parsed.organizationId).toBe("org-1");
  });

  it("accepts an optional transform descriptor", () => {
    const parsed = D3PipelineSchema.parse({
      ...pipeline,
      transform: { op: "aggregate", by: "month" },
    });
    expect(parsed.transform).toEqual({ op: "aggregate", by: "month" });
  });

  it("rejects an empty sql / stationId / organizationId", () => {
    expect(D3PipelineSchema.safeParse({ ...pipeline, sql: "" }).success).toBe(
      false
    );
    expect(
      D3PipelineSchema.safeParse({ ...pipeline, stationId: "" }).success
    ).toBe(false);
    expect(
      D3PipelineSchema.safeParse({ ...pipeline, organizationId: "" }).success
    ).toBe(false);
  });
});

describe("pipeline field on d3 block content (#270)", () => {
  it("is optional — a block without it still parses (fail-safe for pre-#270 / streaming blocks)", () => {
    expect(D3BlockContentSchema.safeParse(inlineContent).success).toBe(true);
    expect(D3BlockContentSchema.safeParse(handleContent).success).toBe(true);
  });

  it("rides the inline variant", () => {
    const parsed = D3InlineContentSchema.parse({ ...inlineContent, pipeline });
    expect(parsed.pipeline).toEqual(pipeline);
  });

  it("rides the handle variant", () => {
    const parsed = D3HandleContentSchema.parse({ ...handleContent, pipeline });
    expect(parsed.pipeline).toEqual(pipeline);
  });
});

// ── Barrel exports (contracts/index.ts) ──────────────────────────────

describe("contracts barrel", () => {
  it("exports D3BlockContentSchema", () => {
    expect(BarrelD3BlockContentSchema).toBe(D3BlockContentSchema);
  });

  it("exports QueryHandleEnvelopeFieldsSchema (portal-sql contract joins the barrel)", () => {
    expect(BarrelEnvelopeFieldsSchema.safeParse(envelopeFields).success).toBe(
      true
    );
  });
});
