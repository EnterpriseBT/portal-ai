/* global AbortController */
import { jest, describe, it, expect, beforeEach } from "@jest/globals";

// ── Mocks (must precede the dynamic import) ──────────────────────────

const mockFindEntityById = jest.fn<(...a: unknown[]) => Promise<unknown>>();
const mockJobsFindById = jest
  .fn<(...a: unknown[]) => Promise<unknown>>()
  .mockResolvedValue(null);
const mockJobsCreate = jest
  .fn<
    (
      userId: string,
      params: { organizationId: string; type: string; metadata?: Record<string, unknown> }
    ) => Promise<{ id: string }>
  >()
  .mockResolvedValue({ id: "job-1" });
const mockJobsCancel = jest
  .fn<(...a: unknown[]) => Promise<unknown>>()
  .mockResolvedValue(undefined);
const mockExplain = jest.fn<() => Promise<void>>().mockResolvedValue();
const mockAssertUnlocked = jest
  .fn<(...a: unknown[]) => Promise<void>>()
  .mockResolvedValue();

type EventCb = (event: {
  jobId: string;
  status: string;
  result?: unknown;
  error?: string | null;
}) => void;
const mockSubscribe = jest.fn<(jobId: string, cb: EventCb) => () => void>();

jest.unstable_mockModule("../../services/db.service.js", () => ({
  DbService: {
    repository: {
      connectorEntities: { findById: mockFindEntityById },
      jobs: { findById: mockJobsFindById },
    },
  },
}));
jest.unstable_mockModule("../../services/jobs.service.js", () => ({
  JobsService: { create: mockJobsCreate, cancel: mockJobsCancel },
}));
jest.unstable_mockModule("../../services/job-events.service.js", () => ({
  JobEventsService: { subscribe: mockSubscribe },
}));
jest.unstable_mockModule("../../services/bulk-aggregate.service.js", () => ({
  BulkAggregateService: { explainExpression: mockExplain },
}));
jest.unstable_mockModule("../../services/job-lock.service.js", () => ({
  JobLockService: { assertConnectorEntityUnlocked: mockAssertUnlocked },
}));

const { BulkAggregateEntityRecordsTool } = await import(
  "../../tools/bulk-aggregate-entity-records.tool.js"
);
const { ApiCode } = await import("../../constants/api-codes.constants.js");

const ORG_ID = "org-1";
const USER_ID = "user-1";
const VALID_INPUT = {
  sourceConnectorEntityId: "ce-source",
  expression: "COUNT(*) AS total",
};

/** Make the next subscribe emit a terminal event asynchronously. */
function emitTerminal(event: { status: string; result?: unknown; error?: string | null }) {
  mockSubscribe.mockImplementation((jobId, cb) => {
    setTimeout(() => cb({ jobId, ...event }), 0);
    return () => {};
  });
}

async function exec(input: Record<string, unknown> = VALID_INPUT) {
  const t = new BulkAggregateEntityRecordsTool().build(ORG_ID, USER_ID);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return await (t as any).execute(input, {
    toolCallId: "t",
    messages: [],
    abortSignal: new AbortController().signal,
  });
}

describe("BulkAggregateEntityRecordsTool", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockFindEntityById.mockReset().mockResolvedValue({ organizationId: ORG_ID });
    mockJobsFindById.mockReset().mockResolvedValue(null);
    mockJobsCreate.mockReset().mockResolvedValue({ id: "job-1" });
    mockExplain.mockReset().mockResolvedValue();
    mockSubscribe.mockReset();
  });

  // ── Case 9 — unknown source ────────────────────────────────────────
  it("rejects an unknown source entity", async () => {
    mockFindEntityById.mockResolvedValueOnce(null);
    await expect(exec()).rejects.toMatchObject({
      code: ApiCode.CONNECTOR_ENTITY_NOT_FOUND,
    });
    expect(mockJobsCreate).not.toHaveBeenCalled();
  });

  it("rejects a source from a different org", async () => {
    mockFindEntityById.mockResolvedValueOnce({ organizationId: "other-org" });
    await expect(exec()).rejects.toMatchObject({
      code: ApiCode.CONNECTOR_ENTITY_NOT_FOUND,
    });
  });

  // ── Case 10 — invalid expression ───────────────────────────────────
  it("propagates an EXPLAIN failure and never enqueues", async () => {
    const { ApiError } = await import("../../services/http.service.js");
    mockExplain.mockRejectedValueOnce(
      new ApiError(400, ApiCode.BULK_AGGREGATE_EXPRESSION_INVALID, "bad sql")
    );
    await expect(exec()).rejects.toMatchObject({
      code: ApiCode.BULK_AGGREGATE_EXPRESSION_INVALID,
    });
    expect(mockJobsCreate).not.toHaveBeenCalled();
  });

  // ── Case 11 — happy path: enqueue, await, return envelope ───────────
  it("enqueues, awaits the terminal event, and returns the result envelope", async () => {
    const envelope = { result: { total: 5 }, recordsProcessed: 5, durationMs: 3 };
    emitTerminal({ status: "completed", result: envelope });

    const out = await exec();
    expect(out).toEqual(envelope);
    expect(mockJobsCreate).toHaveBeenCalledWith(
      USER_ID,
      expect.objectContaining({
        type: "bulk_aggregate",
        metadata: expect.objectContaining({
          sourceConnectorEntityId: "ce-source",
          expression: "COUNT(*) AS total",
        }),
      })
    );
  });

  it("forwards the sourceFilter into the job metadata", async () => {
    emitTerminal({ status: "completed", result: { result: {}, recordsProcessed: 0, durationMs: 1 } });
    await exec({ ...VALID_INPUT, sourceFilter: { whereSqlFragment: "c_age > 30" } });
    expect(mockJobsCreate).toHaveBeenCalledWith(
      USER_ID,
      expect.objectContaining({
        metadata: expect.objectContaining({
          sourceFilter: { whereSqlFragment: "c_age > 30" },
        }),
      })
    );
  });

  // ── Case 12 — terminal failure / cancellation ──────────────────────
  it("throws when the job terminates failed", async () => {
    emitTerminal({ status: "failed", error: "boom" });
    await expect(exec()).rejects.toMatchObject({
      code: ApiCode.BULK_AGGREGATE_EXPRESSION_INVALID,
    });
  });

  it("throws BULK_JOB_CANCELLED when the job is cancelled", async () => {
    emitTerminal({ status: "cancelled" });
    await expect(exec()).rejects.toMatchObject({
      code: ApiCode.BULK_JOB_CANCELLED,
      status: 409,
    });
  });

  // ── Case 13 — no lock check (reads-only) ───────────────────────────
  it("never acquires an entity lock", async () => {
    emitTerminal({ status: "completed", result: { result: {}, recordsProcessed: 0, durationMs: 1 } });
    await exec();
    expect(mockAssertUnlocked).not.toHaveBeenCalled();
  });
});
