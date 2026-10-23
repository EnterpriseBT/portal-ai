/**
 * Job re-dispatch (#852): after a Redis replacement, put every non-terminal
 * `jobs` row whose BullMQ entry is gone back on the queue. Postgres is the
 * record of truth, so the row carries everything the worker needs.
 *
 * Driven through injected deps (like `db-upgrade`'s `UpgradeSteps`) so the
 * ordering — flip the row, then add — and every abort path are asserted
 * without Postgres or Redis. The real thing is in the integration test.
 */
import { jest, describe, it, expect, beforeEach } from "@jest/globals";

import type { JobSelect } from "../../db/schema/zod.js";

// The default deps reach Postgres, Redis and the advisory lock; every test
// injects its own, so these only keep the import side-effect-free.
jest.unstable_mockModule("../../services/db.service.js", () => ({
  DbService: { repository: { jobs: {} } },
}));
jest.unstable_mockModule("../../queues/jobs.queue.js", () => ({
  getJobsQueue: () => ({}),
}));
jest.unstable_mockModule("../../services/sync-lock.service.js", () => ({
  SyncLockService: { withAdvisoryLock: jest.fn() },
  REDISPATCH_LOCK_NAMESPACE: 0,
}));

const { runRedispatch, JobRedispatchService } =
  await import("../../services/job-redispatch.service.js");
type Deps = Parameters<typeof runRedispatch>[1];

const row = (id: string, over: Partial<JobSelect> = {}): JobSelect =>
  ({
    id,
    type: "system_check",
    status: "pending",
    metadata: { foo: id },
    maxAttempts: 3,
    bullJobId: null,
    created: 1,
    ...over,
  }) as JobSelect;

function deps(pages: JobSelect[][], over: Partial<Deps> = {}) {
  const calls: string[] = [];
  const d: Deps = {
    findCandidates: jest.fn(async () => pages.shift() ?? []),
    getQueuedJob: jest.fn(async () => undefined),
    markRedispatched: jest.fn(async (id: string) => {
      calls.push(`mark:${id}`);
      return true;
    }),
    add: jest.fn(async (r: JobSelect) => {
      calls.push(`add:${r.id}`);
    }),
    withLock: async (fn) => ({ acquired: true, value: await fn() }),
    ...over,
  };
  return { d, calls };
}

describe("runRedispatch", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("skips a row already in the queue under its own id", async () => {
    const { d } = deps([[row("j1")]], {
      getQueuedJob: jest.fn(async (id: string) =>
        id === "j1" ? { data: { jobId: "j1" } } : undefined
      ),
    });
    const s = await runRedispatch({ dryRun: false }, d);
    expect(s.present).toBe(1);
    expect(s.redispatched).toEqual([]);
    expect(d.add).not.toHaveBeenCalled();
  });

  it("skips a row present under its legacy BullMQ id, but not a different job that reuses that id", async () => {
    const { d } = deps([
      [row("j1", { bullJobId: "57" }), row("j2", { bullJobId: "58" })],
    ]);
    d.getQueuedJob = jest.fn(async (id: string) => {
      if (id === "57") return { data: { jobId: "j1" } }; // still j1's entry
      if (id === "58") return { data: { jobId: "someone-else" } }; // reused id
      return undefined;
    });
    const s = await runRedispatch({ dryRun: false }, d);
    expect(s.present).toBe(1);
    expect(s.redispatched.map((r) => r.id)).toEqual(["j2"]);
  });

  it("flips the row before adding it, with the row's type, metadata and budget", async () => {
    const { d, calls } = deps([[row("j1", { status: "active" })]]);
    const s = await runRedispatch({ dryRun: false }, d);
    expect(calls).toEqual(["mark:j1", "add:j1"]);
    expect(s.redispatched).toEqual([
      { id: "j1", type: "system_check", priorStatus: "active" },
    ]);
  });

  it("counts a row that went terminal before the flip and never adds it", async () => {
    const { d } = deps([[row("j1")]], {
      markRedispatched: jest.fn(async () => false),
    });
    const s = await runRedispatch({ dryRun: false }, d);
    expect(s.skippedTerminal).toBe(1);
    expect(d.add).not.toHaveBeenCalled();
  });

  it("aborts when the queue can't be read: absence must be observed, not assumed", async () => {
    const { d } = deps([[row("j1")]], {
      getQueuedJob: jest.fn(async () => {
        throw new Error("ECONNREFUSED");
      }),
    });
    await expect(runRedispatch({ dryRun: false }, d)).rejects.toThrow(
      "ECONNREFUSED"
    );
    expect(d.markRedispatched).not.toHaveBeenCalled();
  });

  it("aborts on an add failure, leaving the flipped row for the next run", async () => {
    const { d } = deps([[row("j1"), row("j2")]], {
      add: jest.fn(async () => {
        throw new Error("READONLY");
      }),
    });
    await expect(runRedispatch({ dryRun: false }, d)).rejects.toThrow(
      "READONLY"
    );
    expect(d.markRedispatched).toHaveBeenCalledTimes(1);
  });

  it("writes nothing on a dry run but reports what it would do", async () => {
    const { d } = deps([[row("j1")]]);
    const s = await runRedispatch({ dryRun: true }, d);
    expect(s.dryRun).toBe(true);
    expect(s.redispatched.map((r) => r.id)).toEqual(["j1"]);
    expect(d.markRedispatched).not.toHaveBeenCalled();
    expect(d.add).not.toHaveBeenCalled();
  });

  it("pages past PAGE_SIZE with a (created, id) cursor", async () => {
    const size = JobRedispatchService.PAGE_SIZE;
    const page1 = Array.from({ length: size }, (_, i) =>
      row(`a${i}`, { created: i })
    );
    const { d } = deps([page1, [row("b0", { created: size })]]);
    const s = await runRedispatch({ dryRun: false }, d);
    expect(s.scanned).toBe(size + 1);
    expect(d.findCandidates).toHaveBeenNthCalledWith(1, null, size);
    expect(d.findCandidates).toHaveBeenNthCalledWith(
      2,
      { created: size - 1, id: `a${size - 1}` },
      size
    );
  });

  it("does nothing when another pass holds the lock", async () => {
    const { d } = deps([[row("j1")]], {
      withLock: async () => ({ acquired: false }),
    });
    const s = await runRedispatch({ dryRun: false }, d);
    expect(s.acquiredLock).toBe(false);
    expect(d.findCandidates).not.toHaveBeenCalled();
  });
});
