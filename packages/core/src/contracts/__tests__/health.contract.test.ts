import {
  HealthReadyResponseSchema,
  HealthGetResponseSchema,
} from "../health.contract.js";

describe("HealthReadyResponseSchema", () => {
  it("accepts a valid readiness payload", () => {
    const result = HealthReadyResponseSchema.safeParse({
      ready: true,
      checks: { db: true, redis: true },
    });
    expect(result.success).toBe(true);
  });

  it("accepts a not-ready payload naming the failed dependency", () => {
    const result = HealthReadyResponseSchema.safeParse({
      ready: false,
      checks: { db: true, redis: false },
    });
    expect(result.success).toBe(true);
  });

  it("rejects a payload missing checks", () => {
    const result = HealthReadyResponseSchema.safeParse({ ready: true });
    expect(result.success).toBe(false);
  });

  it("rejects a payload whose checks omit a dependency", () => {
    const result = HealthReadyResponseSchema.safeParse({
      ready: false,
      checks: { db: true },
    });
    expect(result.success).toBe(false);
  });
});

describe("HealthGetResponseSchema (liveness, unchanged)", () => {
  it("still accepts the deps-free liveness payload", () => {
    const result = HealthGetResponseSchema.safeParse({
      timestamp: new Date().toISOString(),
      version: "1.0.0",
      sha: "abc123",
    });
    expect(result.success).toBe(true);
  });
});
