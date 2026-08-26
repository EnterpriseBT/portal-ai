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
