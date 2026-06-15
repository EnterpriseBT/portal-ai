import {
  BulkAggregateMetadataSchema,
  BulkAggregateResultSchema,
  JobTypeEnum,
  JOB_TYPE_SCHEMAS,
} from "../../models/job.model.js";

const SOURCE = "ce-source";

// ── #100 bulk_aggregate ──────────────────────────────────────────────

describe("BulkAggregate schemas (#100)", () => {
  it("JobTypeEnum includes bulk_aggregate", () => {
    expect(JobTypeEnum.safeParse("bulk_aggregate").success).toBe(true);
  });

  it("BulkAggregateMetadataSchema round-trips a minimal aggregate", () => {
    const parsed = BulkAggregateMetadataSchema.parse({
      sourceConnectorEntityId: SOURCE,
      organizationId: "org-1",
      expression: "COUNT(*) AS total",
    });
    expect(parsed.expression).toBe("COUNT(*) AS total");
    expect(parsed.sourceFilter).toBeUndefined();
  });

  it("BulkAggregateMetadataSchema accepts an optional sourceFilter", () => {
    const parsed = BulkAggregateMetadataSchema.parse({
      sourceConnectorEntityId: SOURCE,
      organizationId: "org-1",
      expression: "SUM(c_area) AS total, AVG(c_age) AS avg_age",
      sourceFilter: { whereSqlFragment: "c_age > 30" },
    });
    expect(parsed.sourceFilter?.whereSqlFragment).toBe("c_age > 30");
  });

  it("BulkAggregateMetadataSchema rejects missing required fields", () => {
    expect(
      BulkAggregateMetadataSchema.safeParse({
        sourceConnectorEntityId: SOURCE,
        // missing organizationId + expression
      }).success
    ).toBe(false);
  });

  it("BulkAggregateMetadataSchema declares no write/lock keys", () => {
    const parsed = BulkAggregateMetadataSchema.parse({
      sourceConnectorEntityId: SOURCE,
      organizationId: "org-1",
      expression: "COUNT(*) AS total",
    }) as Record<string, unknown>;
    expect(parsed.targetConnectorEntityIds).toBeUndefined();
    expect(parsed.writes).toBeUndefined();
  });

  it.each([
    ["scalar", 42],
    ["object", { total: 100, avg_age: 37.5 }],
    ["array", [{ orbit: "near", n: 3 }]],
  ])("BulkAggregateResultSchema round-trips a %s result", (_label, result) => {
    const parsed = BulkAggregateResultSchema.parse({
      result,
      recordsProcessed: 1000,
      durationMs: 1234,
    });
    expect(parsed.result).toEqual(result);
    expect(parsed.recordsProcessed).toBe(1000);
  });

  it("JOB_TYPE_SCHEMAS has a bulk_aggregate entry matching the exported schemas", () => {
    expect(JOB_TYPE_SCHEMAS.bulk_aggregate).toBeDefined();
    expect(JOB_TYPE_SCHEMAS.bulk_aggregate.metadata).toBe(
      BulkAggregateMetadataSchema
    );
    expect(JOB_TYPE_SCHEMAS.bulk_aggregate.result).toBe(
      BulkAggregateResultSchema
    );
  });
});
