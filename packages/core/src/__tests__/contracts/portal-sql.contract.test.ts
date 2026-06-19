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
    });
    expect(parsed.sampled).toBe(true);
    expect(parsed.sampleSize).toBe(50_000);
  });

  // #129: `sql` is retained for cursor-tier re-execution; streamability is
  // decided at read time (no precomputed sortKey / cursor flag — decision B).
  it("retains the sql for cursor-tier re-execution", () => {
    const parsed = QueryHandleEnvelopeSchema.parse({
      queryHandle: "qh-cur",
      rowCount: 500_000,
      schema: [{ name: "_record_id", type: "uuid" }],
      sampled: true,
      sampleSize: 50_000,
      truncated: true,
      samplePeek: [],
      sql: "SELECT _record_id, ts FROM big ORDER BY ts",
    });
    expect(parsed.sql).toBe("SELECT _record_id, ts FROM big ORDER BY ts");
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
