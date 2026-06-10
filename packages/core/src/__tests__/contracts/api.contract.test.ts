import { ApiErrorSchema } from "../../contracts/api.contract.js";

describe("ApiErrorSchema", () => {
  it("parses a payload with `recommendation`", () => {
    const parsed = ApiErrorSchema.parse({
      success: false,
      message: "Entity locked.",
      code: "BULK_JOB_TARGET_LOCKED",
      recommendation: "Wait for the running job to finish.",
    });
    expect(parsed.recommendation).toBe(
      "Wait for the running job to finish."
    );
  });

  it("parses a payload without `recommendation` (back-compat)", () => {
    const parsed = ApiErrorSchema.parse({
      success: false,
      message: "Not found.",
      code: "ENTITY_NOT_FOUND",
    });
    expect(parsed.recommendation).toBeUndefined();
  });

  it("round-trips: parse → serialize → parse yields the same object", () => {
    const original = {
      success: false as const,
      message: "Query timed out.",
      code: "PORTAL_SQL_TIMEOUT",
      recommendation: "Try a tighter WHERE clause.",
      details: { sql: "SELECT * FROM big_table" },
    };
    const parsed = ApiErrorSchema.parse(original);
    const reparsed = ApiErrorSchema.parse(JSON.parse(JSON.stringify(parsed)));
    expect(reparsed).toEqual(original);
  });
});
