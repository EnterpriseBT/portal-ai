/**
 * The maintenance worker's job-name dispatch (#442).
 *
 * The scheduler and the worker agree only by convention: `maintenance.queue`
 * registers a repeatable job by name, and `maintenance.worker` switches on
 * that name. Register one without the other and the failure is nightly,
 * silent, and only visible as a "Maintenance job failed" log line — there is
 * no jobs-table row and no SSE for this queue by design.
 *
 * So this asserts the pairing directly: every job name the queue registers
 * is a name the worker dispatches, and an unknown name still throws rather
 * than resolving quietly.
 */
import { jest, describe, it, expect, beforeEach } from "@jest/globals";

type Handler = (job: { name: string }) => Promise<unknown>;

let capturedHandler: Handler | undefined;

class FakeWorker {
  constructor(_name: string, handler: Handler, _opts: unknown) {
    capturedHandler = handler;
  }
  on(): this {
    return this;
  }
}

const mockUpsertJobScheduler = jest.fn<(...a: unknown[]) => Promise<unknown>>();

class FakeQueue {
  upsertJobScheduler = mockUpsertJobScheduler;
  close = async () => undefined;
  // #391: the lazy constructor attaches an "error" log handler.
  on = () => undefined;
}

jest.unstable_mockModule("bullmq", () => ({
  Worker: FakeWorker,
  Queue: FakeQueue,
}));

const mockLedger = jest.fn<() => Promise<unknown>>();
const mockEntityRecord = jest.fn<() => Promise<unknown>>();

jest.unstable_mockModule(
  "../../queues/processors/ledger-retention-purge.processor.js",
  () => ({ ledgerRetentionPurgeProcessor: mockLedger })
);
jest.unstable_mockModule(
  "../../queues/processors/entity-record-retention-purge.processor.js",
  () => ({ entityRecordRetentionPurgeProcessor: mockEntityRecord })
);

const { createMaintenanceWorker } =
  await import("../../queues/maintenance.worker.js");
const {
  registerMaintenanceSchedulers,
  LEDGER_RETENTION_PURGE_JOB,
  ENTITY_RECORD_RETENTION_PURGE_JOB,
} = await import("../../queues/maintenance.queue.js");

describe("maintenance worker dispatch", () => {
  beforeEach(() => {
    capturedHandler = undefined;
    mockLedger.mockReset().mockResolvedValue({ purged: 0 });
    mockEntityRecord.mockReset().mockResolvedValue({ purgedOrphan: 0 });
    mockUpsertJobScheduler.mockReset().mockResolvedValue(undefined);
    createMaintenanceWorker();
  });

  it("dispatches the ledger retention purge", async () => {
    await capturedHandler!({ name: LEDGER_RETENTION_PURGE_JOB });
    expect(mockLedger).toHaveBeenCalledTimes(1);
    expect(mockEntityRecord).not.toHaveBeenCalled();
  });

  it("dispatches the entity-record retention purge (#442)", async () => {
    await capturedHandler!({ name: ENTITY_RECORD_RETENTION_PURGE_JOB });
    expect(mockEntityRecord).toHaveBeenCalledTimes(1);
    expect(mockLedger).not.toHaveBeenCalled();
  });

  it("throws on an unknown job name rather than resolving quietly", async () => {
    await expect(capturedHandler!({ name: "not-a-job" })).rejects.toThrow(
      /Unknown maintenance job/
    );
  });

  it("every registered scheduler name has a worker branch", async () => {
    // The guard that matters: this fails if a future job is added to the
    // scheduler and not to the worker, which would otherwise only surface
    // as a nightly log line.
    await registerMaintenanceSchedulers();

    const registeredNames = mockUpsertJobScheduler.mock.calls.map(
      (c) => c[0] as string
    );
    expect(registeredNames.length).toBeGreaterThan(0);

    for (const name of registeredNames) {
      await expect(capturedHandler!({ name })).resolves.not.toThrow();
    }
  });
});
