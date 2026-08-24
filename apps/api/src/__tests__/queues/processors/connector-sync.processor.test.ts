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
import type { Job as BullJob } from "bullmq";

const mockInstancesFindById = jest.fn<(...a: unknown[]) => Promise<unknown>>();
const mockDefinitionsFindById =
  jest.fn<(...a: unknown[]) => Promise<unknown>>();
const mockSyncInstance = jest.fn<(...a: unknown[]) => Promise<unknown>>();
const mockRegistryGet = jest.fn<(...a: unknown[]) => unknown>();

jest.unstable_mockModule("../../../services/db.service.js", () => ({
  DbService: {
    repository: {
      connectorInstances: { findById: mockInstancesFindById },
      connectorDefinitions: { findById: mockDefinitionsFindById },
    },
  },
}));

jest.unstable_mockModule("../../../adapters/adapter.registry.js", () => ({
  ConnectorAdapterRegistry: { get: mockRegistryGet },
}));

const { connectorSyncProcessor } =
  await import("../../../queues/processors/connector-sync.processor.js");

const JOB_ID = "job-7d39dc22";
const INSTANCE_ID = "inst-c0c9e751";

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
  mockRegistryGet.mockReturnValue({ syncInstance: mockSyncInstance });
});

describe("connectorSyncProcessor — jobId threading (#439)", () => {
  it("passes the app-level jobId through to syncInstance", async () => {
    await connectorSyncProcessor(bullJob() as never);

    expect(mockSyncInstance).toHaveBeenCalledTimes(1);
    const opts = mockSyncInstance.mock.calls[0][2] as { jobId?: string };
    expect(opts.jobId).toBe(JOB_ID);
  });

  it("still forwards progress to BullMQ", async () => {
    const job = bullJob();
    await connectorSyncProcessor(job as never);

    const opts = mockSyncInstance.mock.calls[0][2] as {
      progress?: (p: number) => void;
    };
    expect(typeof opts.progress).toBe("function");
    opts.progress?.(42);
    expect(job.updateProgress).toHaveBeenCalledWith(42);
  });

  it("passes instance and userId unchanged", async () => {
    await connectorSyncProcessor(bullJob() as never);
    expect(mockSyncInstance.mock.calls[0][0]).toMatchObject({
      id: INSTANCE_ID,
    });
    expect(mockSyncInstance.mock.calls[0][1]).toBe("user-1");
  });
});
