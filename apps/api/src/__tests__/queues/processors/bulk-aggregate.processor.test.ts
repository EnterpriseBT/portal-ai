import { jest, describe, it, expect, beforeEach, beforeAll } from "@jest/globals";

// ── Mocks (must precede the dynamic import) ──────────────────────────

const mockRunAggregate =
  jest.fn<
    () => Promise<{ result: unknown; recordsProcessed: number }>
  >();

jest.unstable_mockModule("../../../services/bulk-aggregate.service.js", () => ({
  BulkAggregateService: { runAggregate: mockRunAggregate },
}));

// ── SUT ──────────────────────────────────────────────────────────────

let bulkAggregateProcessor: typeof import("../../../queues/processors/bulk-aggregate.processor.js").bulkAggregateProcessor;
let ApiCode: typeof import("../../../constants/api-codes.constants.js").ApiCode;

beforeAll(async () => {
  bulkAggregateProcessor = (
    await import("../../../queues/processors/bulk-aggregate.processor.js")
  ).bulkAggregateProcessor;
  ApiCode = (await import("../../../constants/api-codes.constants.js")).ApiCode;
});

beforeEach(() => {
  mockRunAggregate.mockReset();
});

type ProcessorJob = Parameters<typeof bulkAggregateProcessor>[0];

function makeJob(overrides: Record<string, unknown> = {}): ProcessorJob {
  return {
    data: {
      jobId: "job-1",
      type: "bulk_aggregate",
      sourceConnectorEntityId: "ce-source",
      organizationId: "org-1",
      expression: "COUNT(*) AS total",
      ...overrides,
    },
  } as unknown as ProcessorJob;
}

// ── Case 6 — scalar aggregate ────────────────────────────────────────

describe("bulkAggregateProcessor", () => {
  it("returns the aggregate result + recordsProcessed + durationMs", async () => {
    mockRunAggregate.mockResolvedValueOnce({
      result: { total: 5 },
      recordsProcessed: 5,
    });

    const out = (await bulkAggregateProcessor(makeJob())) as {
      result: unknown;
      recordsProcessed: number;
      durationMs: number;
    };

    expect(out.result).toEqual({ total: 5 });
    expect(out.recordsProcessed).toBe(5);
    expect(typeof out.durationMs).toBe("number");
    expect(out.durationMs).toBeGreaterThanOrEqual(0);
  });

  // ── Case 7 — multi-alias object result ─────────────────────────────
  it("passes through a multi-alias object result", async () => {
    mockRunAggregate.mockResolvedValueOnce({
      result: { total: 100, avg_age: 37.5 },
      recordsProcessed: 1000,
    });

    const out = (await bulkAggregateProcessor(
      makeJob({ expression: "SUM(c_area) AS total, AVG(c_age) AS avg_age" })
    )) as { result: unknown };

    expect(out.result).toEqual({ total: 100, avg_age: 37.5 });
  });

  it("forwards the sourceFilter to runAggregate", async () => {
    mockRunAggregate.mockResolvedValueOnce({ result: { total: 1 }, recordsProcessed: 1 });
    await bulkAggregateProcessor(
      makeJob({ sourceFilter: { whereSqlFragment: "c_age > 30" } })
    );
    expect(mockRunAggregate).toHaveBeenCalledWith(
      expect.objectContaining({ whereSqlFragment: "c_age > 30" })
    );
  });

  // ── Case 8 — result over the size cap ──────────────────────────────
  it("throws BULK_AGGREGATE_RESULT_TOO_LARGE when the result exceeds the cap", async () => {
    mockRunAggregate.mockResolvedValueOnce({
      result: { blob: "x".repeat(1024 * 1024 + 10) },
      recordsProcessed: 1,
    });

    await expect(bulkAggregateProcessor(makeJob())).rejects.toMatchObject({
      code: ApiCode.BULK_AGGREGATE_RESULT_TOO_LARGE,
      status: 400,
    });
  });
});
