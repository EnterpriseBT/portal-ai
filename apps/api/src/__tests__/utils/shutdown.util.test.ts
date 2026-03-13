import http from "node:http";

import { describe, it, expect, jest, beforeEach } from "@jest/globals";

import { gracefulShutdown, ShutdownDeps } from "../../utils/shutdown.util.js";

// ── Helpers ─────────────────────────────────────────────────────────

/** Tracks the order in which teardown functions are called. */
function createOrderedMocks() {
  const callOrder: string[] = [];

  const closeWorker = jest.fn<() => Promise<void>>().mockImplementation(() => {
    callOrder.push("worker");
    return Promise.resolve();
  });
  const closeQueue = jest.fn<() => Promise<void>>().mockImplementation(() => {
    callOrder.push("queue");
    return Promise.resolve();
  });
  const closeRedis = jest.fn<() => Promise<void>>().mockImplementation(() => {
    callOrder.push("redis");
    return Promise.resolve();
  });
  const closeDatabase = jest
    .fn<() => Promise<void>>()
    .mockImplementation(() => {
      callOrder.push("database");
      return Promise.resolve();
    });

  return { callOrder, closeWorker, closeQueue, closeRedis, closeDatabase };
}

/** Creates a minimal HTTP server listening on an ephemeral port. */
function createTestServer(): Promise<http.Server> {
  return new Promise((resolve) => {
    const server = http.createServer();
    server.listen(0, () => resolve(server));
  });
}

// ── Tests ───────────────────────────────────────────────────────────

describe("gracefulShutdown", () => {
  let mocks: ReturnType<typeof createOrderedMocks>;

  beforeEach(() => {
    mocks = createOrderedMocks();
  });

  it("closes resources in order: worker → queue → Redis → database", async () => {
    const deps: ShutdownDeps = { server: undefined, ...mocks };

    await gracefulShutdown(deps);

    expect(mocks.callOrder).toEqual(["worker", "queue", "redis", "database"]);
  });

  it("calls every teardown function exactly once", async () => {
    const deps: ShutdownDeps = { server: undefined, ...mocks };

    await gracefulShutdown(deps);

    expect(mocks.closeWorker).toHaveBeenCalledTimes(1);
    expect(mocks.closeQueue).toHaveBeenCalledTimes(1);
    expect(mocks.closeRedis).toHaveBeenCalledTimes(1);
    expect(mocks.closeDatabase).toHaveBeenCalledTimes(1);
  });

  it("closes the HTTP server before other resources", async () => {
    const server = await createTestServer();
    const serverClosedAt: number[] = [];

    // Spy on server.close to record when it fires
    const originalClose = server.close.bind(server);
    server.close = ((cb?: (err?: Error) => void) => {
      return originalClose(() => {
        serverClosedAt.push(mocks.callOrder.length);
        cb?.();
      });
    }) as typeof server.close;

    const deps: ShutdownDeps = { server, ...mocks };

    await gracefulShutdown(deps);

    // Server should have closed before any resource teardown
    expect(serverClosedAt).toEqual([0]);
    expect(mocks.callOrder).toEqual(["worker", "queue", "redis", "database"]);
  });

  it("proceeds without error when server is undefined", async () => {
    const deps: ShutdownDeps = { server: undefined, ...mocks };

    await expect(gracefulShutdown(deps)).resolves.toBeUndefined();
    expect(mocks.closeWorker).toHaveBeenCalled();
  });

  it("propagates errors from closeWorker", async () => {
    mocks.closeWorker.mockRejectedValueOnce(new Error("worker error"));
    const deps: ShutdownDeps = { server: undefined, ...mocks };

    await expect(gracefulShutdown(deps)).rejects.toThrow("worker error");

    // Subsequent teardown functions should NOT have been called
    expect(mocks.closeQueue).not.toHaveBeenCalled();
  });

  it("propagates errors from closeQueue", async () => {
    mocks.closeQueue.mockRejectedValueOnce(new Error("queue error"));
    const deps: ShutdownDeps = { server: undefined, ...mocks };

    await expect(gracefulShutdown(deps)).rejects.toThrow("queue error");

    // Worker should have been called, but Redis and DB should not
    expect(mocks.closeWorker).toHaveBeenCalled();
    expect(mocks.closeRedis).not.toHaveBeenCalled();
  });

  it("propagates errors from closeRedis", async () => {
    mocks.closeRedis.mockRejectedValueOnce(new Error("redis error"));
    const deps: ShutdownDeps = { server: undefined, ...mocks };

    await expect(gracefulShutdown(deps)).rejects.toThrow("redis error");

    expect(mocks.closeWorker).toHaveBeenCalled();
    expect(mocks.closeQueue).toHaveBeenCalled();
    expect(mocks.closeDatabase).not.toHaveBeenCalled();
  });

  it("propagates errors from closeDatabase", async () => {
    mocks.closeDatabase.mockRejectedValueOnce(new Error("db error"));
    const deps: ShutdownDeps = { server: undefined, ...mocks };

    await expect(gracefulShutdown(deps)).rejects.toThrow("db error");

    // All prior steps should have succeeded
    expect(mocks.callOrder).toEqual(["worker", "queue", "redis"]);
  });
});
