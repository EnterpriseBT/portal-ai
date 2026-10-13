/**
 * The processor is the only production caller of `adapter.syncInstance`
 * (`sync.service.ts` and `wide-table-resync.service.ts` only check that
 * it exists, then enqueue). It is therefore the single place that can
 * supply `jobId`, and #439's whole fix depends on it doing so —
 * `deriveSourceId` falls back to `runStartedAt` when `jobId` is absent,
 * which is exactly the per-attempt churn the ticket removes.
 *
 * These tests exist so that fallback can never quietly become the
 * production path again.
 */
import { jest, describe, it, expect, beforeEach } from "@jest/globals";
import { UnrecoverableError, type Job as BullJob } from "bullmq";

const mockInstancesFindById = jest.fn<(...a: unknown[]) => Promise<unknown>>();
const mockDefinitionsFindById =
  jest.fn<(...a: unknown[]) => Promise<unknown>>();
const mockSyncInstance = jest.fn<(...a: unknown[]) => Promise<unknown>>();
const mockRegistryFind = jest.fn<(...a: unknown[]) => unknown>();
const mockFindRunning = jest.fn<(...a: unknown[]) => Promise<unknown[]>>();
const mockWithInstanceLock =
  jest.fn<(id: string, fn: () => Promise<unknown>) => Promise<unknown>>();

jest.unstable_mockModule("../../../services/db.service.js", () => ({
  DbService: {
    repository: {
      connectorInstances: { findById: mockInstancesFindById },
      connectorDefinitions: { findById: mockDefinitionsFindById },
    },
  },
}));

// #769: the superseded pass names the holder from the job lock model.
jest.unstable_mockModule("../../../services/job-lock.service.js", () => ({
  JobLockService: { findRunning: mockFindRunning },
}));

jest.unstable_mockModule("../../../services/sync-lock.service.js", () => ({
  SyncLockService: { withInstanceLock: mockWithInstanceLock },
}));

jest.unstable_mockModule("../../../adapters/adapter.registry.js", () => ({
  ConnectorAdapterRegistry: { find: mockRegistryFind },
}));

const { connectorSyncProcessor } =
  await import("../../../queues/processors/connector-sync.processor.js");

const JOB_ID = "job-7d39dc22";
const INSTANCE_ID = "inst-c0c9e751";
const HOLDS = `instance:${INSTANCE_ID}`;

function bullJob(): BullJob<{
  jobId: string;
  connectorInstanceId: string;
  userId: string;
}> {
  return {
    data: {
      jobId: JOB_ID,
      connectorInstanceId: INSTANCE_ID,
      userId: "user-1",
    },
    updateProgress: jest.fn<(p: number) => Promise<void>>(),
  } as unknown as BullJob<{
    jobId: string;
    connectorInstanceId: string;
    userId: string;
  }>;
}

beforeEach(() => {
  jest.clearAllMocks();
  mockInstancesFindById.mockResolvedValue({
    id: INSTANCE_ID,
    connectorDefinitionId: "def-1",
  });
  mockDefinitionsFindById.mockResolvedValue({ id: "def-1", slug: "rest-api" });
  mockSyncInstance.mockResolvedValue({
    recordCounts: { created: 1, updated: 0, unchanged: 0, deleted: 0 },
  });
  mockRegistryFind.mockReturnValue({ syncInstance: mockSyncInstance });
  mockFindRunning.mockResolvedValue([]);
  // Default: the lock is granted, so existing cases behave as before.
  mockWithInstanceLock.mockImplementation(async (_id, fn) => ({
    acquired: true,
    value: await fn(),
  }));
});

describe("connectorSyncProcessor — jobId threading (#439)", () => {
  it("passes the app-level jobId through to syncInstance", async () => {
    await connectorSyncProcessor(bullJob() as never);

    expect(mockSyncInstance).toHaveBeenCalledTimes(1);
    const opts = mockSyncInstance.mock.calls[0][2] as { jobId?: string };
    expect(opts.jobId).toBe(JOB_ID);
  });

  it("forwards structured progress updates to BullMQ verbatim (#458)", async () => {
    const job = bullJob();
    await connectorSyncProcessor(job as never);

    const opts = mockSyncInstance.mock.calls[0][2] as {
      progress?: (update: Record<string, unknown>) => void;
    };
    expect(typeof opts.progress).toBe("function");
    opts.progress?.({ processed: 123954, total: 397960 });
    expect(job.updateProgress).toHaveBeenCalledWith({
      processed: 123954,
      total: 397960,
    });
    opts.progress?.({ percent: 100 });
    expect(job.updateProgress).toHaveBeenCalledWith({ percent: 100 });
  });

  it("passes instance and userId unchanged", async () => {
    await connectorSyncProcessor(bullJob() as never);
    expect(mockSyncInstance.mock.calls[0][0]).toMatchObject({
      id: INSTANCE_ID,
    });
    expect(mockSyncInstance.mock.calls[0][1]).toBe("user-1");
  });
});

// #774: a sync whose prerequisites are gone can never succeed. A plain error
// would retry it through the whole budget while it holds the connector's
// lock, so each of these fails the job on its first attempt.
describe("connectorSyncProcessor — a sync that can never run (#774)", () => {
  async function expectUnrecoverable(message: string) {
    const err = await connectorSyncProcessor(bullJob() as never).then(
      () => undefined,
      (e: unknown) => e
    );
    expect(err).toBeInstanceOf(UnrecoverableError);
    expect((err as Error).message).toBe(message);
    expect(mockWithInstanceLock).not.toHaveBeenCalled();
    expect(mockSyncInstance).not.toHaveBeenCalled();
  }

  it("fails a sync whose connector is gone", async () => {
    mockInstancesFindById.mockResolvedValue(undefined);
    await expectUnrecoverable(`Connector instance not found: ${INSTANCE_ID}`);
  });

  it("fails a sync whose connector definition is gone", async () => {
    mockDefinitionsFindById.mockResolvedValue(undefined);
    await expectUnrecoverable("Connector definition not found: def-1");
  });

  it("fails a sync for a connector type with no adapter", async () => {
    mockRegistryFind.mockReturnValue(undefined);
    await expectUnrecoverable(
      'No connector adapter registered for slug "rest-api"'
    );
  });

  it("fails a sync for an adapter without syncInstance", async () => {
    mockRegistryFind.mockReturnValue({});
    await expectUnrecoverable(
      "Adapter rest-api does not implement syncInstance"
    );
  });

  it("leaves a failing read retryable", async () => {
    mockInstancesFindById.mockRejectedValue(new Error("connection reset"));
    const err = await connectorSyncProcessor(bullJob() as never).then(
      () => undefined,
      (e: unknown) => e
    );
    expect(err).toBeInstanceOf(Error);
    expect(err).not.toBeInstanceOf(UnrecoverableError);
  });
});

describe("connectorSyncProcessor — sync ownership lock (#460)", () => {
  /** Make the lock refuse, as it does when another live pass holds it. */
  const lockRefused = () =>
    mockWithInstanceLock.mockResolvedValue({ acquired: false });

  it("runs the adapter and passes its result through when the lock is granted", async () => {
    const result = await connectorSyncProcessor(bullJob() as never);

    expect(mockSyncInstance).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({
      recordCounts: { created: 1, updated: 0, unchanged: 0, deleted: 0 },
    });
    expect(result).not.toHaveProperty("superseded");
  });

  it("takes the lock keyed by the connector instance", async () => {
    await connectorSyncProcessor(bullJob() as never);

    expect(mockWithInstanceLock.mock.calls[0][0]).toBe(INSTANCE_ID);
  });

  it("does NOT call the adapter when the lock is refused", async () => {
    lockRefused();

    await connectorSyncProcessor(bullJob() as never);

    // The whole fix: a pass that cannot prove ownership must not reap.
    expect(mockSyncInstance).not.toHaveBeenCalled();
  });

  it("reports superseded with zeroed counts when the lock is refused", async () => {
    lockRefused();

    const result = await connectorSyncProcessor(bullJob() as never);

    expect(result).toMatchObject({
      superseded: true,
      recordCounts: { created: 0, updated: 0, unchanged: 0, deleted: 0 },
    });
  });

  it("names the holder in supersededBy when a sibling job is running", async () => {
    lockRefused();
    mockFindRunning.mockResolvedValue([
      { id: JOB_ID, type: "connector_sync", lockScopes: [HOLDS] },
      { id: "job-other", type: "connector_sync", lockScopes: [HOLDS] },
    ]);

    const result = await connectorSyncProcessor(bullJob() as never);

    // Its own row is excluded — a job cannot supersede itself.
    expect(result).toMatchObject({ supersededBy: "job-other" });
  });

  it("an entity-level job isn't the sync lock's holder (#769)", async () => {
    lockRefused();
    mockFindRunning.mockResolvedValue([
      { id: "job-reval", type: "revalidation", lockScopes: ["entity:e1"] },
    ]);

    const result = await connectorSyncProcessor(bullJob() as never);

    expect(result).not.toHaveProperty("supersededBy");
  });

  it("omits supersededBy when no sibling job can be identified", async () => {
    lockRefused();
    mockFindRunning.mockResolvedValue([
      { id: JOB_ID, type: "connector_sync", lockScopes: [HOLDS] },
    ]);

    const result = await connectorSyncProcessor(bullJob() as never);

    // A holder can exist without a distinguishable job row; the field is
    // best-effort, so it is omitted rather than guessed.
    expect(result).not.toHaveProperty("supersededBy");
  });

  it("still returns superseded when the sibling lookup itself throws", async () => {
    lockRefused();
    mockFindRunning.mockRejectedValue(new Error("db hiccup"));

    const result = await connectorSyncProcessor(bullJob() as never);

    // Best-effort means best-effort: a failed lookup must not turn a
    // correctly-skipped pass into a failed job.
    expect(result).toMatchObject({ superseded: true });
    expect(result).not.toHaveProperty("supersededBy");
  });

  it("does not throw on the refused path — nothing failed", async () => {
    lockRefused();

    // #441's principle: a job that did no work has not failed. Throwing here
    // would make BullMQ retry it into the same wall.
    await expect(
      connectorSyncProcessor(bullJob() as never)
    ).resolves.toBeDefined();
  });
});
