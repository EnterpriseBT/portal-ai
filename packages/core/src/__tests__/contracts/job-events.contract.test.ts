import { JobBatchEventSchema } from "../../contracts/job-events.contract.js";

describe("JobBatchEventSchema", () => {
  it("accepts a counters-only event (no rows, no rowIds)", () => {
    const parsed = JobBatchEventSchema.parse({
      _eventType: "batch",
      recordsProcessed: 1000,
      totalRecords: 10000,
      batchDurationMs: 487,
    });
    expect(parsed.rows).toBeUndefined();
    expect(parsed.rowIds).toBeUndefined();
  });

  it("accepts an inline-rows event", () => {
    const parsed = JobBatchEventSchema.parse({
      _eventType: "batch",
      recordsProcessed: 1000,
      totalRecords: 10000,
      batchDurationMs: 487,
      rows: [
        { record_id: "r-1", c_acreage: 3.7 },
        { record_id: "r-2", c_acreage: 5.1 },
      ],
      failureCount: 0,
    });
    expect(parsed.rows).toHaveLength(2);
  });

  it("accepts a row-id-fallback event", () => {
    const parsed = JobBatchEventSchema.parse({
      _eventType: "batch",
      recordsProcessed: 1000,
      totalRecords: 10000,
      batchDurationMs: 487,
      rowIds: ["r-1", "r-2", "r-3"],
    });
    expect(parsed.rowIds).toEqual(["r-1", "r-2", "r-3"]);
  });

  it("rejects an event with negative counters", () => {
    const result = JobBatchEventSchema.safeParse({
      _eventType: "batch",
      recordsProcessed: -5,
      totalRecords: 10000,
      batchDurationMs: 487,
    });
    expect(result.success).toBe(false);
  });
});
