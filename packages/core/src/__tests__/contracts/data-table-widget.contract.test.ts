import {
  DataTableBlockContentSchema,
  DataTableHandleContentSchema,
  DataTableInlineContentSchema,
} from "../../contracts/data-table-widget.contract.js";
import { DataTableBlockContentSchema as BarrelDataTableBlockContentSchema } from "../../contracts/index.js";

// ── Fixtures ─────────────────────────────────────────────────────────

const pipeline = {
  sql: "SELECT name, acres FROM parcels ORDER BY acres DESC LIMIT 10",
  stationId: "st-1",
  organizationId: "org-1",
};

const inlineContent = {
  columns: ["name", "acres"],
  rows: [
    { name: "North Ridge", acres: 412 },
    { name: "Cedar Flat", acres: 388 },
  ],
};

const envelopeFields = {
  queryHandle: "qh-table-abc",
  rowCount: 13_427,
  schema: [
    { name: "name", type: "text" },
    { name: "acres", type: "numeric" },
  ],
  sampled: false,
  truncated: false,
  samplePeek: [{ name: "North Ridge", acres: 412 }],
  sql: "SELECT name, acres FROM parcels",
};

const handleContent = { ...envelopeFields };

// ── Inline variant ───────────────────────────────────────────────────

describe("DataTableInlineContentSchema (#349)", () => {
  it("parses columns + rows with a pipeline", () => {
    const parsed = DataTableInlineContentSchema.parse({
      ...inlineContent,
      pipeline,
    });
    expect(parsed.columns).toEqual(["name", "acres"]);
    expect(parsed.rows).toHaveLength(2);
    expect(parsed.pipeline?.sql).toBe(pipeline.sql);
  });

  // The optionality is what keeps this a zero-migration change: every block
  // minted before #349 has no pipeline and must still parse (it renders, it
  // just can't refresh — the `notRefreshable` path).
  it("parses without a pipeline (pre-#349 block)", () => {
    expect(DataTableInlineContentSchema.safeParse(inlineContent).success).toBe(
      true
    );
  });

  it("rejects a pipeline missing its sql", () => {
    const result = DataTableInlineContentSchema.safeParse({
      ...inlineContent,
      pipeline: { stationId: "st-1", organizationId: "org-1" },
    });
    expect(result.success).toBe(false);
  });

  it("carries the d3 codegen-fallback message when present", () => {
    const parsed = DataTableInlineContentSchema.parse({
      ...inlineContent,
      message: "Couldn't generate the visualization; showing the query result.",
    });
    expect(parsed.message).toContain("Couldn't generate");
  });
});

// ── Handle variant ───────────────────────────────────────────────────

describe("DataTableHandleContentSchema (#349)", () => {
  it("parses a full envelope with a pipeline", () => {
    const parsed = DataTableHandleContentSchema.parse({
      ...handleContent,
      pipeline,
    });
    expect(parsed.queryHandle).toBe("qh-table-abc");
    expect(parsed.rowCount).toBe(13_427);
    expect(parsed.pipeline?.stationId).toBe("st-1");
  });

  it("parses without a pipeline", () => {
    expect(DataTableHandleContentSchema.safeParse(handleContent).success).toBe(
      true
    );
  });
});

// ── Union ordering ───────────────────────────────────────────────────

describe("DataTableBlockContentSchema (#349)", () => {
  it("resolves handle content to the handle branch", () => {
    const parsed = DataTableBlockContentSchema.parse(handleContent);
    expect(parsed).toHaveProperty("queryHandle", "qh-table-abc");
  });

  it("resolves inline content to the inline branch", () => {
    const parsed = DataTableBlockContentSchema.parse(inlineContent);
    expect(parsed).toHaveProperty("columns");
    expect(parsed).not.toHaveProperty("queryHandle");
  });

  /**
   * Handle branch first, mirroring `D3BlockContentSchema` for the same reason:
   * the inline schema would otherwise swallow a queryHandle-carrying block as
   * an extra key whenever `rows` is also present.
   */
  it("prefers the handle branch when both queryHandle and rows are present", () => {
    const parsed = DataTableBlockContentSchema.parse({
      ...handleContent,
      columns: ["name", "acres"],
      rows: inlineContent.rows,
    });
    expect(parsed).toHaveProperty("queryHandle", "qh-table-abc");
  });

  it("rejects content that is neither inline nor handle", () => {
    expect(
      DataTableBlockContentSchema.safeParse({ title: "orphan" }).success
    ).toBe(false);
  });

  it("is re-exported from the contracts barrel", () => {
    expect(BarrelDataTableBlockContentSchema).toBe(DataTableBlockContentSchema);
  });
});
