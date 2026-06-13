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
const mockFetchSourceBatch = jest
  .fn<() => Promise<Array<Record<string, unknown>>>>()
  .mockResolvedValue([]);
// Slice 4 (#99) replaced the legacy upsert-result-as-number shape with
// `{ rowsUpserted, droppedKeys }`. Default mock returns a clean batch.
interface UpsertSuccessesArgs {
  targetConnectorEntityId: string;
  organizationId: string;
  jobId: string;
  successes: Array<{ sourceKey: string; value: Record<string, unknown> }>;
  userId: string;
}
const mockUpsertSuccesses = jest
  .fn<
    (
      args: UpsertSuccessesArgs
    ) => Promise<{ rowsUpserted: number; droppedKeys: string[] }>
  >()
  .mockResolvedValue({ rowsUpserted: 0, droppedKeys: [] });

jest.unstable_mockModule(
  "../../../services/bulk-transform.service.js",
  () => ({
    BulkTransformService: {
      countSourceRows: mockCountSourceRows,
      runBatch: mockRunBatch,
      // Phase 4 additions — these mocks aren't exercised by the
      // SQL-path tests in this file, but the imports resolve through
      // them at module load.
      fetchSourceBatch: mockFetchSourceBatch,
      upsertSuccesses: mockUpsertSuccesses,
    },
  })
);

const mockLookupBulkDispatchable = jest
  .fn<() => Promise<unknown | null>>()
  .mockResolvedValue(null);
jest.unstable_mockModule("../../../services/tools.service.js", () => ({
  ToolService: {
    lookupBulkDispatchable: mockLookupBulkDispatchable,
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
      targetConnectorEntityIds: ["ce-target"],
      expression: {
        kind: "sql",
        value: "ST_Area(geometry::geography) / 4047 AS acreage",
        writes: [
          {
            targetConnectorEntityId: "ce-target",
            column: "acreage",
            valueFrom: { kind: "sql_alias", alias: "acreage" },
          },
        ],
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
        writes: [
          {
            targetConnectorEntityId: "ce-target",
            column: "c_distance_km",
            valueFrom: { kind: "tool_result" },
          },
        ],
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

// ── Slice 4 (#99) — tool-kind multi-write fan-out ───────────────────

describe("bulkTransformProcessor — tool path multi-write (Phase 4 / #99 slice 4)", () => {
  const STATION_ID = "station-001";
  const TARGET_A = "ce-target-a";
  const TARGET_B = "ce-target-b";

  function makeToolJob(
    writes: Array<{
      targetConnectorEntityId: string;
      column: string;
      valueFrom: { kind: string } & Record<string, unknown>;
    }>,
    state: "active" | "failed" = "active"
  ): BullJob {
    return {
      data: {
        jobId: "job-bt-multi",
        type: "bulk_transform",
        sourceConnectorEntityId: "ce-source",
        targetConnectorEntityIds: Array.from(
          new Set(writes.map((w) => w.targetConnectorEntityId))
        ).sort(),
        expression: { kind: "tool", ref: "compute_x", writes },
        keyField: "c_id",
        batchSize: 10,
        organizationId: "org-1",
        stationId: STATION_ID,
        userId: "user-1",
      },
      getState: jest
        .fn<() => Promise<string>>()
        .mockResolvedValue(state),
    } as unknown as BullJob;
  }

  beforeEach(() => {
    mockCountSourceRows.mockReset().mockResolvedValue(2);
    mockFetchSourceBatch.mockReset().mockResolvedValue([
      { c_id: "p-1", c_name: "Alice" },
      { c_id: "p-2", c_name: "Bob" },
    ]);
    mockPublishCustomEvent.mockReset().mockResolvedValue(undefined);
    mockUpsertSuccesses
      .mockReset()
      // Mirror "successes.length rows committed" — the simplest
      // contract that matches the live SQL.
      .mockImplementation(async (opts) => ({
        rowsUpserted: opts.successes.length,
        droppedKeys: [],
      }));
    // ToolService.lookupBulkDispatchable returns an executor that
    // emits a `{ km, miles }` per record. The dispatcher (real, not
    // mocked) calls this executor once per source row.
    mockLookupBulkDispatchable.mockReset().mockResolvedValue({
      executor: async () => ({ km: 5, miles: 3.1 }),
      metadata: {
        maxConcurrency: 4,
        timeoutMs: 5_000,
        idempotent: true,
      },
    });
  });

  // Case 4.1 — two writes against the SAME target → one upsertSuccesses
  // call with both columns in the per-record value object.
  it("groups two writes against one target into a single upsertSuccesses call carrying both columns", async () => {
    const job = makeToolJob([
      {
        targetConnectorEntityId: TARGET_A,
        column: "c_km",
        valueFrom: { kind: "tool_path", path: "km" },
      },
      {
        targetConnectorEntityId: TARGET_A,
        column: "c_miles",
        valueFrom: { kind: "tool_path", path: "miles" },
      },
    ]);

    const result = await bulkTransformProcessor(job);

    expect(mockUpsertSuccesses).toHaveBeenCalledTimes(1);
    const arg = mockUpsertSuccesses.mock.calls[0][0];
    expect(arg.targetConnectorEntityId).toBe(TARGET_A);
    expect(arg.successes).toHaveLength(2);
    expect(arg.successes[0].value).toEqual({ c_km: 5, c_miles: 3.1 });
    expect(result.recordsProcessed).toBe(2);
    expect(result.recordsFailed).toBe(0);
  });

  // Case 4.2 — two writes against TWO different targets → two
  // upsertSuccesses calls, one per target, each carrying its subset.
  it("fans out per-target writes into separate upsertSuccesses calls", async () => {
    const job = makeToolJob([
      {
        targetConnectorEntityId: TARGET_A,
        column: "c_km",
        valueFrom: { kind: "tool_path", path: "km" },
      },
      {
        targetConnectorEntityId: TARGET_B,
        column: "c_summary",
        valueFrom: { kind: "tool_result" },
      },
    ]);

    const result = await bulkTransformProcessor(job);

    expect(mockUpsertSuccesses).toHaveBeenCalledTimes(2);
    const callsByTarget = new Map<string, Record<string, unknown>>();
    for (const call of mockUpsertSuccesses.mock.calls) {
      const arg = call[0];
      callsByTarget.set(arg.targetConnectorEntityId, arg.successes[0].value);
    }
    expect(callsByTarget.get(TARGET_A)).toEqual({ c_km: 5 });
    expect(callsByTarget.get(TARGET_B)).toEqual({
      c_summary: { km: 5, miles: 3.1 },
    });
    expect(result.recordsProcessed).toBe(2);
    expect(result.recordsFailed).toBe(0);
  });

  // Case 4.3 — target B's upsertSuccesses rejects; target A still
  // commits; failures carry `{ targetConnectorEntityId, column }`.
  it("isolates per-target failures — target A commits, target B's failure surfaces in partialFailures", async () => {
    mockUpsertSuccesses.mockImplementation(async (opts) => {
      if (opts.targetConnectorEntityId === TARGET_B) {
        throw new Error("target B exploded");
      }
      return { rowsUpserted: opts.successes.length, droppedKeys: [] };
    });

    const job = makeToolJob([
      {
        targetConnectorEntityId: TARGET_A,
        column: "c_km",
        valueFrom: { kind: "tool_path", path: "km" },
      },
      {
        targetConnectorEntityId: TARGET_B,
        column: "c_summary",
        valueFrom: { kind: "tool_result" },
      },
    ]);

    const result = await bulkTransformProcessor(job);

    // Both target calls were attempted.
    expect(mockUpsertSuccesses).toHaveBeenCalledTimes(2);
    // recordsProcessed counts each dispatched record once (both
    // targets are part of the same pipeline; the source record
    // completed).
    expect(result.recordsProcessed).toBe(2);
    // Two failures — one per source key against target B.
    expect(result.partialFailures).toHaveLength(2);
    for (const f of result.partialFailures!) {
      expect(f.targetConnectorEntityId).toBe(TARGET_B);
      expect(f.column).toBe("c_summary");
      expect(f.error.message).toContain("target B exploded");
    }
  });

  // Bloat-control (#99 follow-up): drizzle wraps PG errors in
  // DrizzleQueryError whose .message is a giant SQL+params dump.
  // The processor should persist the .cause's short PG message
  // instead, so the result row stays a sensible size.
  it("uses the PG cause's short message, not the drizzle wrapper's SQL+params dump", async () => {
    const drizzleErr = new Error(
      "Failed query: WITH input_rows ... massive sql text ...\nparams: ..."
    );
    (drizzleErr as Error & { cause?: unknown }).cause = Object.assign(
      new Error('invalid input syntax for type numeric: "hello"'),
      { code: "22P02" }
    );
    mockUpsertSuccesses.mockImplementation(async () => {
      throw drizzleErr;
    });

    const job = makeToolJob([
      {
        targetConnectorEntityId: TARGET_A,
        column: "c_km",
        valueFrom: { kind: "tool_path", path: "km" },
      },
    ]);

    const result = await bulkTransformProcessor(job);

    expect(result.partialFailures).toHaveLength(2);
    for (const f of result.partialFailures!) {
      // Short, includes the PG code prefix + the cause's message.
      expect(f.error.message).toBe(
        '22P02: invalid input syntax for type numeric: "hello"'
      );
      expect(f.error.message).not.toContain("Failed query:");
      expect(f.error.message).not.toContain("WITH input_rows");
    }
  });

  // Bloat-control (#99 follow-up): even with the short-message fix,
  // a pathological run (every record fails for the same reason) can
  // pile up tens of thousands of entries. Cap at MAX_PARTIAL_FAILURES
  // and surface the omitted count.
  it("caps partialFailures[] to bound the result row size", async () => {
    // Generate a batch larger than the cap by setting the fixture's
    // batch size + source count high enough.
    const manyRows = Array.from({ length: 150 }, (_, i) => ({
      c_id: `p-${i}`,
      c_name: `n-${i}`,
    }));
    mockCountSourceRows.mockResolvedValue(manyRows.length);
    mockFetchSourceBatch.mockResolvedValue(manyRows);
    mockUpsertSuccesses.mockImplementation(async () => {
      throw new Error("everything explodes");
    });

    const job = makeToolJob([
      {
        targetConnectorEntityId: TARGET_A,
        column: "c_km",
        valueFrom: { kind: "tool_path", path: "km" },
      },
    ]);
    // Override the job's batchSize to fit all rows in one batch.
    (job.data as Record<string, unknown>).batchSize = 200;

    const result = await bulkTransformProcessor(job);

    expect(result.recordsFailed).toBe(150);
    // Array capped at the per-job ceiling.
    expect(result.partialFailures).toHaveLength(100);
    // Tail is summarized as a count.
    expect(result.partialFailuresOmitted).toBe(50);
  });
});
