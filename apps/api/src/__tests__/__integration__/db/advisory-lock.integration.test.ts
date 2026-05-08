/* eslint-disable @typescript-eslint/no-explicit-any -- escape hatch for drizzle ORM client typings */
/**
 * Integration tests for `withEntityLock` and `entityLockKey`.
 *
 * Tests use two independent Postgres connections so two concurrent
 * `withEntityLock` calls really do contend for the underlying
 * advisory lock — single-connection tests would deadlock at the
 * application level instead.
 */

import { describe, it, expect, beforeAll, afterAll } from "@jest/globals";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { sql } from "drizzle-orm";

import {
  withEntityLock,
  entityLockKey,
} from "../../../db/advisory-lock.util.js";
import type { DbClient } from "../../../db/repositories/base.repository.js";

describe("Advisory lock — withEntityLock + entityLockKey", () => {
  let connectionA!: ReturnType<typeof postgres>;
  let connectionB!: ReturnType<typeof postgres>;
  let dbA!: DbClient;
  let dbB!: DbClient;

  beforeAll(() => {
    if (!process.env.DATABASE_URL) {
      throw new Error("DATABASE_URL not set - setup.ts should have set this");
    }
    // Two independent connection pools so the two test callers don't
    // share session-level lock ownership.
    connectionA = postgres(process.env.DATABASE_URL, { max: 1 });
    connectionB = postgres(process.env.DATABASE_URL, { max: 1 });
    dbA = drizzle(connectionA);
    dbB = drizzle(connectionB);
  });

  afterAll(async () => {
    await connectionA.end();
    await connectionB.end();
  });

  // ── Case 22 — same key serialises ────────────────────────────────

  it("withEntityLock serializes two concurrent calls for the same entity", async () => {
    const entityId = "ent-same-key";
    const HOLD_MS = 200;

    // A signals once it's inside the lock so we can deterministically
    // launch B against an already-held lock.
    let aHasLockResolve!: () => void;
    const aHasLock = new Promise<void>((resolve) => {
      aHasLockResolve = resolve;
    });
    let aEndAt = 0;
    let bStartAt = 0;

    const a = withEntityLock(dbA, entityId, async () => {
      aHasLockResolve();
      await new Promise((resolve) => setTimeout(resolve, HOLD_MS));
      aEndAt = Date.now();
    });

    await aHasLock;
    const bLaunch = Date.now();
    const b = withEntityLock(dbB, entityId, async () => {
      bStartAt = Date.now();
    });

    await Promise.all([a, b]);
    const bElapsed = bStartAt - bLaunch;

    // B did not enter its callback until A released the lock.
    expect(aEndAt).toBeGreaterThan(0);
    expect(bStartAt).toBeGreaterThanOrEqual(aEndAt);

    // B's wait time is bounded below by the remaining hold.
    // Allow some slack for timer drift; the lower bound just needs to
    // demonstrate non-trivial blocking.
    expect(bElapsed).toBeGreaterThanOrEqual(HOLD_MS / 2);
  });

  // ── Case 23 — different keys do not block each other ─────────────

  it("does not block calls for a different entity", async () => {
    const HOLD_MS = 200;
    const start = Date.now();

    const a = withEntityLock(dbA, "ent-A", async () => {
      await new Promise((resolve) => setTimeout(resolve, HOLD_MS));
    });
    const b = withEntityLock(dbB, "ent-B", async () => {
      await new Promise((resolve) => setTimeout(resolve, HOLD_MS));
    });

    await Promise.all([a, b]);
    const elapsed = Date.now() - start;

    // Both finish in roughly one hold (parallel), not two.
    expect(elapsed).toBeLessThan(HOLD_MS * 1.6);
  });

  // ── Case 24 — lock released on rollback ──────────────────────────

  it("releases the lock when the callback throws", async () => {
    const entityId = "ent-rollback";

    await expect(
      withEntityLock(dbA, entityId, async () => {
        throw new Error("boom");
      })
    ).rejects.toThrow("boom");

    // Subsequent acquire should be immediate (lock was released by the
    // tx's automatic ROLLBACK).
    const start = Date.now();
    await withEntityLock(dbA, entityId, async () => {
      // no-op
    });
    const elapsed = Date.now() - start;
    expect(elapsed).toBeLessThan(100);
  });

  // ── entityLockKey is deterministic ──────────────────────────────

  it("entityLockKey is deterministic and fits a signed 64-bit int", () => {
    const k1 = entityLockKey("entity-abc");
    const k2 = entityLockKey("entity-abc");
    const k3 = entityLockKey("entity-def");
    expect(k1).toBe(k2);
    expect(k1).not.toBe(k3);

    // Within the signed 64-bit range.
    const max = (1n << 63n) - 1n;
    const min = -(1n << 63n);
    expect(k1).toBeGreaterThanOrEqual(min);
    expect(k1).toBeLessThanOrEqual(max);
  });

  // ── Sanity: the actual lock function call works against Postgres ──

  it("issues a real pg_advisory_xact_lock call", async () => {
    // Whitebox-y: just confirm the function name resolves and runs
    // without error inside a transaction.
    const key = entityLockKey("ent-smoke");
    await (dbA as any).transaction(async (tx: any) => {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(${key}::bigint)`);
    });
  });
});
