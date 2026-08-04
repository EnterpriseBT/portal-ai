/**
 * `incrementRateWindow` — the shared fixed-window rate counter.
 *
 * The timeout race exists because of a bug found while smoke-walking #311:
 * `redis.util.ts` sets `maxRetriesPerRequest: null` (BullMQ requires it), so a
 * command issued while Redis is unreachable is QUEUED rather than rejected —
 * ioredis's offline queue holds it until reconnect. Every caller of this
 * function documents "fail open on a Redis blip" and implements it as a
 * `try/catch`, but a promise that never settles reaches no catch block.
 *
 * The observed symptom on the anonymous `/api/public/site-config` route was a
 * request that hung past 45s instead of being allowed through — worse than the
 * 500 the fail-open was written to avoid, and reachable with no credential.
 *
 * So: bound the Redis call and REJECT on timeout. Rejection is what the four
 * existing call sites already treat as "allow" (cost gate, both viz-refresh
 * routers, the public rate limiter), which makes their documented posture
 * true without touching any of them.
 */

import { jest, describe, it, expect, beforeEach } from "@jest/globals";

const mockIncr = jest.fn<(key: string) => Promise<number>>();
const mockExpire = jest.fn<(key: string, ttl: number) => Promise<number>>();

jest.unstable_mockModule("../../utils/redis.util.js", () => ({
  getRedisClient: () => ({ incr: mockIncr, expire: mockExpire }),
}));

const { incrementRateWindow, REDIS_OP_TIMEOUT_MS } =
  await import("../../utils/rate-limit.util.js");

/** A promise that never settles — exactly what ioredis's offline queue
 *  produces while Redis is unreachable. */
const neverSettles = <T>() => new Promise<T>(() => {});

beforeEach(() => {
  mockIncr.mockReset();
  mockExpire.mockReset();
  mockExpire.mockResolvedValue(1);
});

describe("incrementRateWindow", () => {
  // ── happy path ─────────────────────────────────────────────────────

  it("returns the incremented count for the current wall-clock minute", async () => {
    mockIncr.mockResolvedValue(7);

    await expect(incrementRateWindow("org-1:metered", 120_000)).resolves.toBe(
      7
    );

    expect(mockIncr).toHaveBeenCalledWith("usage:rate:org-1:metered:2");
    // Only the first increment of a window sets the TTL.
    expect(mockExpire).not.toHaveBeenCalled();
  });

  it("sets the window TTL on the first increment only", async () => {
    mockIncr.mockResolvedValue(1);

    await incrementRateWindow("org-1:metered", 120_000);

    expect(mockExpire).toHaveBeenCalledWith("usage:rate:org-1:metered:2", 120);
  });

  it("buckets by wall-clock minute", async () => {
    mockIncr.mockResolvedValue(2);

    await incrementRateWindow("k", 59_999);
    await incrementRateWindow("k", 60_000);

    expect(mockIncr.mock.calls.map(([key]) => key)).toEqual([
      "usage:rate:k:0",
      "usage:rate:k:1",
    ]);
  });

  // ── the bug: a hanging command must reject, not hang ───────────────

  it("rejects rather than hanging when INCR never settles", async () => {
    mockIncr.mockReturnValue(neverSettles<number>());

    const start = Date.now();
    await expect(incrementRateWindow("k")).rejects.toThrow(/timed out/i);
    // Bounded, and nowhere near the 45s hang the smoke walk observed.
    expect(Date.now() - start).toBeLessThan(REDIS_OP_TIMEOUT_MS + 500);
  });

  it("rejects rather than hanging when EXPIRE never settles", async () => {
    mockIncr.mockResolvedValue(1); // first of the window ⇒ EXPIRE runs
    mockExpire.mockReturnValue(neverSettles<number>());

    await expect(incrementRateWindow("k")).rejects.toThrow(/timed out/i);
  });

  it("names the operation in the timeout message", async () => {
    mockIncr.mockReturnValue(neverSettles<number>());
    await expect(incrementRateWindow("k")).rejects.toThrow(/INCR/);
  });

  // ── a genuine error still rejects (unchanged behavior) ─────────────

  it("propagates a real Redis rejection", async () => {
    mockIncr.mockRejectedValue(new Error("READONLY replica"));
    await expect(incrementRateWindow("k")).rejects.toThrow(/READONLY/);
  });

  // ── a late rejection must not become an unhandled rejection ────────

  it("does not emit an unhandled rejection when the raced call fails late", async () => {
    let rejectLate: (err: Error) => void = () => {};
    mockIncr.mockReturnValue(
      new Promise<number>((_, reject) => {
        rejectLate = reject;
      })
    );

    const unhandled = jest.fn();
    process.once("unhandledRejection", unhandled);

    await expect(incrementRateWindow("k")).rejects.toThrow(/timed out/i);
    // The abandoned command loses its race, then fails — a crash risk if the
    // implementation leaves it unobserved.
    rejectLate(new Error("connection reset"));
    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(unhandled).not.toHaveBeenCalled();
    process.removeListener("unhandledRejection", unhandled);
  });
});
