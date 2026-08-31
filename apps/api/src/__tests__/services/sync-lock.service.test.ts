/**
 * The sync ownership lock (#460 slice 1).
 *
 * A connector sync can be re-delivered by BullMQ while its first invocation is
 * still running, so two passes execute over one instance. Each ends by reaping
 * "everything older than my watermark", so the later pass deletes the earlier
 * pass's still-in-flight writes — measured at 34,000 records lost from a
 * 397,960-record layer, on a job reporting `completed`.
 *
 * No reap predicate fixes that: "rows this pass did not touch" is *correct*
 * from each pass's own point of view. What is wrong is the premise that one
 * pass is the only writer. So a pass has to prove ownership first.
 *
 * These cases pin the primitive's contract. The property that justifies
 * choosing a Postgres session lock over a Redis TTL lease — that the lock dies
 * with the holding session — cannot be mocked and is asserted against a real
 * server in `sync-lock.integration.test.ts`.
 *
 * The release paths carry most of the risk here: a reserved connection that is
 * not released is permanently gone from a pool of 10, so every early-return
 * and throw path has its own case.
 */
import { jest, describe, it, expect, beforeEach } from "@jest/globals";

type Row = Record<string, unknown>;

const mockUnsafe =
  jest.fn<(sql: string, params?: unknown[]) => Promise<Row[]>>();
const mockRelease = jest.fn<() => void>();

const reserved = {
  unsafe: mockUnsafe,
  release: mockRelease,
};

const mockReserveConnection = jest.fn<() => Promise<typeof reserved>>();

jest.unstable_mockModule("../../db/client.js", () => ({
  reserveConnection: mockReserveConnection,
  db: {},
}));

jest.unstable_mockModule("../../environment.js", () => ({
  environment: { LOG_LEVEL: "silent" },
}));

const { SyncLockService, SYNC_LOCK_NAMESPACE } =
  await import("../../services/sync-lock.service.js");

/** Make the next `pg_try_advisory_lock` return `granted`. */
const lockReturns = (granted: boolean) => {
  mockUnsafe.mockImplementation(async (sql: string) => {
    if (sql.includes("pg_try_advisory_lock")) return [{ locked: granted }];
    return [{}]; // pg_advisory_unlock
  });
};

const INSTANCE = "inst-7d028f9a";

describe("SyncLockService.withInstanceLock (#460)", () => {
  beforeEach(() => {
    mockUnsafe.mockReset();
    mockRelease.mockReset();
    mockReserveConnection.mockReset().mockResolvedValue(reserved);
  });

  it("runs fn and returns its value when the lock is granted", async () => {
    lockReturns(true);

    const out = await SyncLockService.withInstanceLock(
      INSTANCE,
      async () => 42
    );

    expect(out).toEqual({ acquired: true, value: 42 });
  });

  it("does NOT run fn when the lock is refused", async () => {
    lockReturns(false);
    const fn = jest.fn<() => Promise<number>>(async () => 1);

    const out = await SyncLockService.withInstanceLock(INSTANCE, fn);

    // The entire point: a pass that cannot prove ownership does no work.
    // Running fn here would reap under a foreign owner.
    expect(fn).not.toHaveBeenCalled();
    expect(out).toEqual({ acquired: false });
  });

  it("releases the connection on the refused path", async () => {
    lockReturns(false);

    await SyncLockService.withInstanceLock(INSTANCE, async () => 1);

    expect(mockRelease).toHaveBeenCalledTimes(1);
  });

  it("unlocks and releases on the success path", async () => {
    lockReturns(true);

    await SyncLockService.withInstanceLock(INSTANCE, async () => 1);

    const sqls = mockUnsafe.mock.calls.map((c) => c[0]);
    expect(sqls.some((s) => s.includes("pg_advisory_unlock"))).toBe(true);
    expect(mockRelease).toHaveBeenCalledTimes(1);
  });

  it("unlocks, releases, and rethrows when fn throws", async () => {
    lockReturns(true);
    const boom = new Error("sync blew up");

    await expect(
      SyncLockService.withInstanceLock(INSTANCE, async () => {
        throw boom;
      })
    ).rejects.toThrow(boom);

    const sqls = mockUnsafe.mock.calls.map((c) => c[0]);
    expect(sqls.some((s) => s.includes("pg_advisory_unlock"))).toBe(true);
    expect(mockRelease).toHaveBeenCalledTimes(1);
  });

  it("still releases the connection when the unlock itself throws", async () => {
    // A reserved connection that is never released is permanently gone from a
    // pool of 10. Losing it because the *unlock* failed would be a slow leak
    // that only shows up as connection-acquisition timeouts much later.
    mockUnsafe.mockImplementation(async (sql: string) => {
      if (sql.includes("pg_try_advisory_lock")) return [{ locked: true }];
      throw new Error("connection reset during unlock");
    });

    const out = await SyncLockService.withInstanceLock(INSTANCE, async () => 7);

    expect(out).toEqual({ acquired: true, value: 7 });
    expect(mockRelease).toHaveBeenCalledTimes(1);
  });

  it("releases the connection when fn throws AND the unlock throws", async () => {
    let first = true;
    mockUnsafe.mockImplementation(async (sql: string) => {
      if (sql.includes("pg_try_advisory_lock") && first) {
        first = false;
        return [{ locked: true }];
      }
      throw new Error("connection reset during unlock");
    });
    const boom = new Error("sync blew up");

    await expect(
      SyncLockService.withInstanceLock(INSTANCE, async () => {
        throw boom;
      })
    ).rejects.toThrow(boom); // fn's error wins, not the unlock's

    expect(mockRelease).toHaveBeenCalledTimes(1);
  });

  it("uses the namespaced two-int form, keyed by the instance id", async () => {
    lockReturns(true);

    await SyncLockService.withInstanceLock(INSTANCE, async () => 1);

    const [sql, params] = mockUnsafe.mock.calls[0];
    // Two-int form: a bare `pg_try_advisory_lock(bigint)` shares one keyspace
    // with every other advisory-lock user in the database.
    expect(sql).toMatch(
      /pg_try_advisory_lock\(\s*\$1\s*,\s*hashtext\(\s*\$2\s*\)\s*\)/
    );
    expect(params).toEqual([SYNC_LOCK_NAMESPACE, INSTANCE]);
  });

  it("never blocks — uses try, not the blocking pg_advisory_lock", async () => {
    lockReturns(false);

    await SyncLockService.withInstanceLock(INSTANCE, async () => 1);

    const sqls = mockUnsafe.mock.calls.map((c) => c[0]).join(" ");
    // A pass that would block is a pass that should abort: blocking holds a
    // worker slot for the duration of someone else's sync.
    expect(sqls).not.toMatch(/\bpg_advisory_lock\(/);
  });
});

describe("SyncLockService.withInstanceLockWait (#461)", () => {
  beforeEach(() => {
    mockUnsafe.mockReset();
    mockRelease.mockReset();
    mockReserveConnection.mockReset().mockResolvedValue(reserved);
  });

  /** Queue try-lock responses; unlock and anything past the queue succeed. */
  const lockSequence = (grants: boolean[]) => {
    const queue = [...grants];
    mockUnsafe.mockImplementation(async (sql: string) => {
      if (sql.includes("pg_try_advisory_lock"))
        return [{ locked: queue.shift() ?? false }];
      return [{}]; // pg_advisory_unlock
    });
  };

  it("runs fn immediately when the lock is free", async () => {
    lockSequence([true]);

    const value = await SyncLockService.withInstanceLockWait(
      INSTANCE,
      async () => 42,
      { timeoutMs: 50, pollMs: 1 }
    );

    expect(value).toBe(42);
    const tries = mockUnsafe.mock.calls.filter(([sql]) =>
      sql.includes("pg_try_advisory_lock")
    );
    expect(tries).toHaveLength(1);
  });

  it("polls until the holder releases, then runs fn", async () => {
    lockSequence([false, false, true]);

    const value = await SyncLockService.withInstanceLockWait(
      INSTANCE,
      async () => "committed",
      { timeoutMs: 5_000, pollMs: 1 }
    );

    expect(value).toBe("committed");
    const tries = mockUnsafe.mock.calls.filter(([sql]) =>
      sql.includes("pg_try_advisory_lock")
    );
    expect(tries).toHaveLength(3);
  });

  it("throws after timeoutMs without running fn, and still releases", async () => {
    lockSequence([]); // never granted
    const fn = jest.fn<() => Promise<number>>(async () => 1);

    await expect(
      SyncLockService.withInstanceLockWait(INSTANCE, fn, {
        timeoutMs: 10,
        pollMs: 2,
      })
    ).rejects.toThrow(/Timed out after 10ms/);

    // The whole point of the wait design: a pass that never proved ownership
    // did no work — BullMQ gets the attempt back via the throw (#441).
    expect(fn).not.toHaveBeenCalled();
    expect(mockRelease).toHaveBeenCalledTimes(1);
    const sqls = mockUnsafe.mock.calls.map((c) => c[0]).join(" ");
    expect(sqls).not.toContain("pg_advisory_unlock"); // never held → no unlock
  });

  it("unlocks, releases, and rethrows when fn throws after a waited acquire", async () => {
    lockSequence([false, true]);
    const boom = new Error("commit blew up");

    await expect(
      SyncLockService.withInstanceLockWait(
        INSTANCE,
        async () => {
          throw boom;
        },
        { timeoutMs: 5_000, pollMs: 1 }
      )
    ).rejects.toThrow(boom);

    const sqls = mockUnsafe.mock.calls.map((c) => c[0]);
    expect(sqls.some((s) => s.includes("pg_advisory_unlock"))).toBe(true);
    expect(mockRelease).toHaveBeenCalledTimes(1);
  });

  it("keeps the whole wait on one reserved session", async () => {
    // A session lock is only as good as the session that took it: acquiring
    // on a different connection than the one that runs fn would hand the lock
    // back to the pool mid-commit.
    lockSequence([false, false, true]);

    await SyncLockService.withInstanceLockWait(INSTANCE, async () => 1, {
      timeoutMs: 5_000,
      pollMs: 1,
    });

    expect(mockReserveConnection).toHaveBeenCalledTimes(1);
    expect(mockRelease).toHaveBeenCalledTimes(1);
  });
});
