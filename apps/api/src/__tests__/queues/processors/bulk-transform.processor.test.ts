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
const mockRunBatch = jest.fn<() => Promise<number>>().mockResolvedValue(0);

jest.unstable_mockModule(
  "../../../services/bulk-transform.service.js",
  () => ({
    BulkTransformService: {
      countSourceRows: mockCountSourceRows,
      runBatch: mockRunBatch,
    },
  })
);

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
    mockRunBatch.mockReset().mockResolvedValue(0);
    mockPublishCustomEvent.mockReset().mockResolvedValue(undefined);
  });

  it("processes a 3-batch SQL job and emits 3 job:batch events with monotonic counters", async () => {
    mockCountSourceRows.mockResolvedValue(3_000);
    mockRunBatch
      .mockResolvedValueOnce(1_000)
      .mockResolvedValueOnce(1_000)
      .mockResolvedValueOnce(1_000);

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
    mockRunBatch.mockResolvedValueOnce(1_000);

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

  it("honors cancellation between batches", async () => {
    mockCountSourceRows.mockResolvedValue(3_000);
    mockRunBatch
      .mockResolvedValueOnce(1_000)
      .mockResolvedValueOnce(1_000);

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

  it("throws BULK_DISPATCH_TOOL_NOT_FOUND for an expression.kind === 'tool' payload", async () => {
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
