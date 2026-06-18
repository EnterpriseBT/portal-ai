import { QueryHandleEnvelopeSchema } from "../../contracts/portal-sql.contract.js";

describe("QueryHandleEnvelopeSchema", () => {
  it("accepts a non-sampled envelope", () => {
    const parsed = QueryHandleEnvelopeSchema.parse({
      queryHandle: "qh-abc123",
      rowCount: 13427,
      schema: [
        { name: "acreage", type: "numeric" },
        { name: "assessed_value", type: "numeric" },
      ],
      sampled: false,
      truncated: false,
      samplePeek: [],
      sql: "SELECT acreage, assessed_value FROM parcels",
      sortKey: null,
      cursor: false,
    });
    expect(parsed.sampled).toBe(false);
    expect(parsed.sampleSize).toBeUndefined();
  });

  it("accepts a sampled envelope with sampleSize", () => {
    const parsed = QueryHandleEnvelopeSchema.parse({
      queryHandle: "qh-xyz",
      rowCount: 1_000_000,
      schema: [{ name: "x", type: "numeric" }],
      sampled: true,
      sampleSize: 50_000,
      truncated: false,
      samplePeek: [{ x: 1 }, { x: 2 }],
      sql: "SELECT x FROM huge",
      sortKey: null,
      cursor: false,
    });
    expect(parsed.sampled).toBe(true);
    expect(parsed.sampleSize).toBe(50_000);
  });

  // #129: the cursor tier coherence guard.
  it("accepts a cursor envelope with a sortKey", () => {
    const parsed = QueryHandleEnvelopeSchema.parse({
      queryHandle: "qh-cur",
      rowCount: 500_000,
      schema: [{ name: "id", type: "uuid" }],
      sampled: true,
      sampleSize: 50_000,
      truncated: true,
      samplePeek: [],
      sql: "SELECT id, ts FROM big ORDER BY ts, id",
      sortKey: "id",
      cursor: true,
    });
    expect(parsed.cursor).toBe(true);
    expect(parsed.sortKey).toBe("id");
  });

  it("rejects cursor: true with a null sortKey", () => {
    const result = QueryHandleEnvelopeSchema.safeParse({
      queryHandle: "qh-bad",
      rowCount: 500_000,
      schema: [{ name: "x", type: "numeric" }],
      sampled: false,
      truncated: true,
      samplePeek: [],
      sql: "SELECT x FROM big",
      sortKey: null,
      cursor: true,
    });
    expect(result.success).toBe(false);
  });

  it("rejects a sampled envelope missing sampleSize", () => {
    const result = QueryHandleEnvelopeSchema.safeParse({
      queryHandle: "qh-xyz",
      rowCount: 1_000_000,
      schema: [{ name: "x", type: "numeric" }],
      sampled: true,
      truncated: false,
      samplePeek: [],
    });
    expect(result.success).toBe(false);
  });

  it("caps samplePeek at 10 rows", () => {
    const elevenRows = Array.from({ length: 11 }, (_, i) => ({ x: i }));
    const result = QueryHandleEnvelopeSchema.safeParse({
      queryHandle: "qh-xyz",
      rowCount: 100,
      schema: [{ name: "x", type: "numeric" }],
      sampled: false,
      truncated: false,
      samplePeek: elevenRows,
    });
    expect(result.success).toBe(false);
  });
});
