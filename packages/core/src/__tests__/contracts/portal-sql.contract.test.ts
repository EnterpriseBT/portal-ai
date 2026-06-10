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
    });
    expect(parsed.sampled).toBe(true);
    expect(parsed.sampleSize).toBe(50_000);
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
