import { jest, describe, it, expect } from "@jest/globals";

/**
 * Regression guard for #220: the BullMQ queues must be constructed *lazily*.
 *
 * `new Queue()` eagerly opens an ioredis connection, so constructing at module
 * load turned a bare `import` (a tool → jobs.service → jobs.queue) into a live
 * Redis socket. With no Redis in unit tests, ioredis's reconnect timer then
 * kept the event loop alive and Jest hung after the suite passed. These tests
 * assert importing the queue modules constructs nothing, and that the getters
 * are singleton + reconstruct after close.
 */

// Count every BullMQ Queue construction and stub the async surface we touch.
const constructions: Array<{ name: string }> = [];
const mockClose = jest.fn<() => Promise<void>>().mockResolvedValue(undefined);

class MockQueue {
  name: string;
  close = mockClose;
  constructor(name: string) {
    this.name = name;
    constructions.push({ name });
  }
}

jest.unstable_mockModule("bullmq", () => ({ Queue: MockQueue }));

const { getJobsQueue, closeJobsQueue, JOBS_QUEUE_NAME } =
  await import("../../queues/jobs.queue.js");
const { getMaintenanceQueue, closeMaintenanceQueue, MAINTENANCE_QUEUE_NAME } =
  await import("../../queues/maintenance.queue.js");

// Captured at import time, before any test runs — order-independent.
const constructionsAfterImport = constructions.length;

const countFor = (name: string) =>
  constructions.filter((c) => c.name === name).length;

describe("lazy BullMQ queue construction (#220)", () => {
  it("constructs no queue merely by importing the modules", () => {
    expect(constructionsAfterImport).toBe(0);
  });

  it("getJobsQueue constructs once, is a singleton, and reconstructs after close", async () => {
    const before = countFor(JOBS_QUEUE_NAME);

    const a = getJobsQueue();
    expect(countFor(JOBS_QUEUE_NAME)).toBe(before + 1);

    const b = getJobsQueue();
    expect(b).toBe(a);
    expect(countFor(JOBS_QUEUE_NAME)).toBe(before + 1); // still one

    await closeJobsQueue();
    expect(mockClose).toHaveBeenCalled();

    getJobsQueue();
    expect(countFor(JOBS_QUEUE_NAME)).toBe(before + 2); // reconstructed
    await closeJobsQueue();
  });

  it("getMaintenanceQueue constructs once, is a singleton, and reconstructs after close", async () => {
    const before = countFor(MAINTENANCE_QUEUE_NAME);

    const a = getMaintenanceQueue();
    expect(countFor(MAINTENANCE_QUEUE_NAME)).toBe(before + 1);

    const b = getMaintenanceQueue();
    expect(b).toBe(a);
    expect(countFor(MAINTENANCE_QUEUE_NAME)).toBe(before + 1);

    await closeMaintenanceQueue();
    getMaintenanceQueue();
    expect(countFor(MAINTENANCE_QUEUE_NAME)).toBe(before + 2);
    await closeMaintenanceQueue();
  });

  it("closing a never-constructed queue is a no-op", async () => {
    // Both closed above; a redundant close must not throw or construct.
    const before = constructions.length;
    await closeJobsQueue();
    await closeMaintenanceQueue();
    expect(constructions.length).toBe(before);
  });
});
