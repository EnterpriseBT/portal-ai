import {
  jest,
  describe,
  it,
  expect,
  beforeEach,
} from "@jest/globals";
import type { Job as BullJob } from "bullmq";

// ── Mocks (must precede the dynamic import) ──────────────────────────

const mockCountSourceRows =
  jest.fn<() => Promise<number>>().mockResolvedValue(0);
type BatchResult = {
  rowsCommitted: number;
  rows: Array<Record<string, unknown>>;
};
const mockRunBatch = jest
  .fn<() => Promise<BatchResult>>()
  .mockResolvedValue({ rowsCommitted: 0, rows: [] });

jest.unstable_mockModule(
  "../../../services/bulk-transform.service.js",
  () => ({
    BulkTransformService: {
      countSourceRows: mockCountSourceRows,
      runBatch: mockRunBatch,
      // Phase 4 additions — these mocks aren't exercised by the
      // SQL-path tests in this file, but the imports resolve through
      // them at module load.
      fetchSourceBatch: jest.fn().mockResolvedValue([]),
      upsertSuccesses: jest.fn().mockResolvedValue(0),
    },
  })
);

jest.unstable_mockModule("../../../services/tools.service.js", () => ({
  ToolService: {
    lookupBulkDispatchable: jest.fn().mockResolvedValue(null),
  },
}));

const mockPublishCustomEvent =
  jest.fn<() => Promise<void>>().mockResolvedValue(undefined);

jest.unstable_mockModule("../../../services/job-events.service.js", () => ({
  JobEventsService: {
    publishCustomEvent: mockPublishCustomEvent,
  },
  JobUpdateEventSchema: {},
}));

const { bulkTransformProcessor } = await import(
  "../../../queues/processors/bulk-transform.processor.js"
);
const { ApiCode } = await import(
  "../../../constants/api-codes.constants.js"
);

// ── Helpers ──────────────────────────────────────────────────────────

function makeJob(
  metadata: Record<string, unknown> = {},
  state: "active" | "failed" = "active"
): BullJob {
  return {
    data: {
      jobId: "job-bt-001",
      type: "bulk_transform",
      sourceConnectorEntityId: "ce-source",
      targetConnectorEntityId: "ce-target",
      expression: {
        kind: "sql",
        value: "ST_Area(geometry::geography) / 4047 AS acreage",
      },
      keyField: "parcel_id",
      batchSize: 1000,
      organizationId: "org-1",
      ...metadata,
    },
    getState: jest
      .fn<() => Promise<string>>()
      .mockResolvedValue(state),
  } as unknown as BullJob;
}

// ── Tests ────────────────────────────────────────────────────────────

describe("bulkTransformProcessor — SQL path (Phase 2 slice 0)", () => {
  beforeEach(() => {
    mockCountSourceRows.mockReset().mockResolvedValue(0);
    mockRunBatch
      .mockReset()
      .mockResolvedValue({ rowsCommitted: 0, rows: [] });
    mockPublishCustomEvent.mockReset().mockResolvedValue(undefined);
  });

  it("processes a 3-batch SQL job and emits 3 job:batch events with monotonic counters", async () => {
    mockCountSourceRows.mockResolvedValue(3_000);
    const smallRows = (n: number) =>
      Array.from({ length: n }, (_, i) => ({ id: `r-${i}`, c_acreage: i }));
    mockRunBatch
      .mockResolvedValueOnce({ rowsCommitted: 1_000, rows: smallRows(1_000) })
      .mockResolvedValueOnce({ rowsCommitted: 1_000, rows: smallRows(1_000) })
      .mockResolvedValueOnce({ rowsCommitted: 1_000, rows: smallRows(1_000) });

    const result = await bulkTransformProcessor(makeJob());

    expect(result.recordsProcessed).toBe(3_000);
    expect(result.recordsFailed).toBe(0);
    expect(mockPublishCustomEvent).toHaveBeenCalledTimes(3);

    const counters = mockPublishCustomEvent.mock.calls.map(
      (call) =>
        (
          (call as unknown as [string, string, { recordsProcessed: number }])[2]
        ).recordsProcessed
    );
    expect(counters).toEqual([1_000, 2_000, 3_000]);
  });

  it("each emitted event has _eventType = 'batch' and is keyed to the jobId", async () => {
    mockCountSourceRows.mockResolvedValue(1_000);
    mockRunBatch.mockResolvedValueOnce({
      rowsCommitted: 1_000,
      rows: [{ id: "r-1", c_acreage: 3.7 }],
    });

    await bulkTransformProcessor(makeJob());

    expect(mockPublishCustomEvent).toHaveBeenCalledWith(
      "job-bt-001",
      "batch",
      expect.objectContaining({
        recordsProcessed: 1_000,
        totalRecords: 1_000,
        failureCount: 0,
      })
    );
  });

  it("includes rows in the SSE event when payload fits BATCH_ROW_PAYLOAD_LIMIT", async () => {
    mockCountSourceRows.mockResolvedValue(2);
    mockRunBatch.mockResolvedValueOnce({
      rowsCommitted: 2,
      rows: [
        { id: "r-1", c_acreage: 3.7 },
        { id: "r-2", c_acreage: 5.1 },
      ],
    });

    await bulkTransformProcessor(makeJob({ batchSize: 2 }));

    const evt = (
      mockPublishCustomEvent.mock.calls[0] as unknown as [
        string,
        string,
        { rows?: unknown[] },
      ]
    )[2];
    expect(evt.rows).toEqual([
      { id: "r-1", c_acreage: 3.7 },
      { id: "r-2", c_acreage: 5.1 },
    ]);
  });

  it("omits rows when serialized payload exceeds BATCH_ROW_PAYLOAD_LIMIT", async () => {
    // Build a row whose JSON serializes well past 256 KB.
    const huge = "x".repeat(300_000);
    mockCountSourceRows.mockResolvedValue(1);
    mockRunBatch.mockResolvedValueOnce({
      rowsCommitted: 1,
      rows: [{ id: "r-1", payload: huge }],
    });

    await bulkTransformProcessor(makeJob({ batchSize: 1 }));

    const evt = (
      mockPublishCustomEvent.mock.calls[0] as unknown as [
        string,
        string,
        { rows?: unknown[]; recordsProcessed: number },
      ]
    )[2];
    expect(evt.rows).toBeUndefined();
    // Counters still update — the widget keeps its progress bar
    // moving even when the per-batch row payload is dropped.
    expect(evt.recordsProcessed).toBe(1);
  });

  it("honors cancellation between batches", async () => {
    mockCountSourceRows.mockResolvedValue(3_000);
    const smallRows = (n: number) =>
      Array.from({ length: n }, (_, i) => ({ id: `r-${i}` }));
    mockRunBatch
      .mockResolvedValueOnce({ rowsCommitted: 1_000, rows: smallRows(1_000) })
      .mockResolvedValueOnce({ rowsCommitted: 1_000, rows: smallRows(1_000) });

    const job = makeJob();
    let callCount = 0;
    (job.getState as jest.Mock).mockImplementation(async () => {
      callCount++;
      // First two checks return active; the third returns failed
      // (BullMQ's cancellation surfaces as a "failed" state during a
      // discard). Processor should exit before running batch 3.
      return callCount >= 3 ? "failed" : "active";
    });

    const result = await bulkTransformProcessor(job);

    expect(mockRunBatch).toHaveBeenCalledTimes(2);
    expect(result.recordsProcessed).toBe(2_000);
  });

  it("throws BULK_DISPATCH_TOOL_NOT_FOUND when the tool isn't bulk-dispatchable", async () => {
    // ToolService.lookupBulkDispatchable mock returns null by default.
    const job = makeJob({
      expression: {
        kind: "tool",
        ref: "compute_distance_to_nearest_hospital",
      },
    });

    await expect(bulkTransformProcessor(job)).rejects.toMatchObject({
      code: ApiCode.BULK_DISPATCH_TOOL_NOT_FOUND,
    });
    expect(mockRunBatch).not.toHaveBeenCalled();
  });

  it("returns immediately with zero counts when source has no rows", async () => {
    mockCountSourceRows.mockResolvedValue(0);

    const result = await bulkTransformProcessor(makeJob());

    expect(result.recordsProcessed).toBe(0);
    expect(mockRunBatch).not.toHaveBeenCalled();
    expect(mockPublishCustomEvent).not.toHaveBeenCalled();
  });
});
