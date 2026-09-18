/**
 * The sync ownership lock, against a real Postgres (#460 slice 1).
 *
 * The unit suite pins the primitive's contract with a mocked connection. What
 * it cannot prove is the property the entire design was chosen for:
 *
 *   **the lock dies with the session that holds it.**
 *
 * That is the whole argument for a Postgres session advisory lock over a Redis
 * TTL lease. BullMQ re-delivered the job in the first place *because it
 * guessed wrong* about whether the first pass was still alive — its lock
 * renewal was starved by a 6.5-minute reap. A TTL lease answers "is the holder
 * alive?" with another timer, starved by the same reap. A session lock lets
 * the database answer it: the holder's connection is open, or it is not.
 *
 * So case 3 below is deliberately not mocked anywhere. If `reserve()` does not
 * hand out a connection that is its own session, the liveness claim fails here
 * — in a test, before anything depends on it — rather than in production.
 */
import { describe, it, expect, beforeEach, afterEach } from "@jest/globals";
import postgres from "postgres";

import { SyncLockService } from "../../../services/sync-lock.service.js";

const INSTANCE_A = "inst-aaaa-0001";
const INSTANCE_B = "inst-bbbb-0002";

/** Mirrors the service's key derivation so the test locks the same slot. */
const NAMESPACE = 0x5359_4e43;

describe("sync lock against a real database (#460)", () => {
  let outside: ReturnType<typeof postgres>;

  beforeEach(() => {
    if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL not set");
    outside = postgres(process.env.DATABASE_URL, { max: 4 });
  });

  afterEach(async () => {
    await outside.end();
  });

  /** Take the lock on a dedicated session the test controls. */
  const takeOn = async (sql: ReturnType<typeof postgres>, key: string) => {
    const rows = await sql.unsafe(
      `SELECT pg_try_advisory_lock($1, hashtext($2)) AS locked`,
      [NAMESPACE, key]
    );
    return (rows as unknown as Array<{ locked: boolean }>)[0].locked;
  };

  it("only one of two concurrent holders gets the same key", async () => {
    const first = await outside.reserve();
    const second = await outside.reserve();
    try {
      expect(await takeOn(first as never, INSTANCE_A)).toBe(true);
      // Same key, different session — must be refused, not queued.
      expect(await takeOn(second as never, INSTANCE_A)).toBe(false);
    } finally {
      await first.unsafe(`SELECT pg_advisory_unlock($1, hashtext($2))`, [
        NAMESPACE,
        INSTANCE_A,
      ]);
      first.release();
      second.release();
    }
  });

  it("different instance ids do not block each other", async () => {
    const first = await outside.reserve();
    const second = await outside.reserve();
    try {
      // Per-instance keying is what keeps one tenant's long sync from
      // stalling another's; a global lock would be a noisy-neighbour bug.
      expect(await takeOn(first as never, INSTANCE_A)).toBe(true);
      expect(await takeOn(second as never, INSTANCE_B)).toBe(true);
    } finally {
      await first.unsafe(`SELECT pg_advisory_unlock($1, hashtext($2))`, [
        NAMESPACE,
        INSTANCE_A,
      ]);
      await second.unsafe(`SELECT pg_advisory_unlock($1, hashtext($2))`, [
        NAMESPACE,
        INSTANCE_B,
      ]);
      first.release();
      second.release();
    }
  });

  it("releases the lock when the holding SESSION ends, with no explicit unlock", async () => {
    // The keystone. A holder that dies mid-run — process killed, container
    // suspended, connection dropped — must not wedge the instance forever.
    // Nothing here calls pg_advisory_unlock: the session simply ends.
    const dying = postgres(process.env.DATABASE_URL as string, { max: 1 });
    expect(await takeOn(dying, INSTANCE_A)).toBe(true);

    // A separate session cannot take it while the holder lives.
    expect(await takeOn(outside, INSTANCE_A)).toBe(false);

    await dying.end(); // the holder "dies"

    // ...and now it can, without operator action.
    expect(await takeOn(outside, INSTANCE_A)).toBe(true);
    await outside.unsafe(`SELECT pg_advisory_unlock($1, hashtext($2))`, [
      NAMESPACE,
      INSTANCE_A,
    ]);
  });

  it("a reserved connection is its own session — the assumption reserve() has to satisfy", async () => {
    // If reserve() multiplexed onto a shared session, two "different" reserved
    // connections would each see the other's advisory locks as their own and
    // both would succeed. That would silently defeat the whole design, so it
    // is asserted directly rather than inferred from the case above.
    const a = await outside.reserve();
    const b = await outside.reserve();
    try {
      expect(await takeOn(a as never, INSTANCE_B)).toBe(true);
      expect(await takeOn(b as never, INSTANCE_B)).toBe(false);
    } finally {
      await a.unsafe(`SELECT pg_advisory_unlock($1, hashtext($2))`, [
        NAMESPACE,
        INSTANCE_B,
      ]);
      a.release();
      b.release();
    }
  });

  // ── the service itself, against the real server ────────────────────
  //
  // The unit suite mocks the connection, so nothing there executes the SQL
  // this service actually issues — a typo inside `unsafe(...)` would pass
  // every mocked case and fail only at runtime. These two run it for real.

  it("the service acquires and runs fn against a real server", async () => {
    const out = await SyncLockService.withInstanceLock(
      INSTANCE_A,
      async () => "ran"
    );

    expect(out).toEqual({ acquired: true, value: "ran" });
  });

  it("the service refuses while a foreign session holds the key, and recovers after it", async () => {
    const holder = postgres(process.env.DATABASE_URL as string, { max: 1 });
    expect(await takeOn(holder, INSTANCE_A)).toBe(true);

    const blocked = await SyncLockService.withInstanceLock(
      INSTANCE_A,
      async () => "should not run"
    );
    expect(blocked).toEqual({ acquired: false });

    await holder.end();

    // The service releases its own lock in `finally`, so a second call must
    // succeed — proving the success path does not leak the lock either.
    const after = await SyncLockService.withInstanceLock(
      INSTANCE_A,
      async () => "ran"
    );
    expect(after).toEqual({ acquired: true, value: "ran" });

    const again = await SyncLockService.withInstanceLock(
      INSTANCE_A,
      async () => "ran"
    );
    expect(again).toEqual({ acquired: true, value: "ran" });
  });

  // ── the provisioning lock (#583) ───────────────────────────────────
  //
  // Unlike the sync lock (non-blocking: a loser aborts), the provisioning lock
  // WAITS — the loser of a first-login race needs the winner's committed result
  // before it can conclude there is nothing to provision. So the contract is
  // serialization, not refusal.

  const SUB_A = "auth0|prov-aaaa";
  const SUB_B = "auth0|prov-bbbb";

  it("two concurrent holders of one sub run serially, never interleaved", async () => {
    const events: string[] = [];
    const body = (tag: string) => async () => {
      events.push(`start-${tag}`);
      await new Promise((r) => setTimeout(r, 50));
      events.push(`end-${tag}`);
      return tag;
    };

    const [a, b] = await Promise.all([
      SyncLockService.withProvisioningLock(SUB_A, body("A"), { pollMs: 10 }),
      SyncLockService.withProvisioningLock(SUB_A, body("B"), { pollMs: 10 }),
    ]);

    expect([a, b].sort()).toEqual(["A", "B"]);
    // Serialized: each holder's start is immediately followed by its own end —
    // no [start-A, start-B, …] interleave.
    expect(events.length).toBe(4);
    expect(events[0].slice(-1)).toBe(events[1].slice(-1)); // start/end pair
    expect(events[2].slice(-1)).toBe(events[3].slice(-1));
    expect(events[0].startsWith("start")).toBe(true);
    expect(events[2].startsWith("start")).toBe(true);
  });

  it("different subs do not block each other", async () => {
    const running: string[] = [];
    const body = (tag: string) => async () => {
      running.push(tag);
      // Both must be inside `fn` at the same time — a shared lock would prevent
      // this, so it would be a noisy-neighbour bug (one user's first login
      // blocking another's).
      await new Promise((r) => setTimeout(r, 30));
      expect(running.length).toBe(2);
      return tag;
    };

    const [a, b] = await Promise.all([
      SyncLockService.withProvisioningLock(SUB_A, body("A"), { pollMs: 10 }),
      SyncLockService.withProvisioningLock(SUB_B, body("B"), { pollMs: 10 }),
    ]);

    expect([a, b].sort()).toEqual(["A", "B"]);
  });

  it("releases the sub lock on the success path so a later login re-acquires", async () => {
    const first = await SyncLockService.withProvisioningLock(
      SUB_A,
      async () => "ran"
    );
    const second = await SyncLockService.withProvisioningLock(
      SUB_A,
      async () => "ran-again"
    );
    expect(first).toBe("ran");
    expect(second).toBe("ran-again");
  });
});
