import {
  describe,
  it,
  expect,
  beforeEach,
  afterEach,
  jest,
} from "@jest/globals";

import {
  apiReadPauseRemainingMs,
  isApiRateLimited,
  pauseApiReads,
  resetApiReadPause,
  retryAfterMs,
  waitForApiReadPause,
} from "../utils/rate-limit.util";

/**
 * #747: the tab-wide read pause behind `429 API_RATE_LIMITED`. Mirrors the
 * tile pause (#705): clamped to [1s, 60s], 2s when the wait is unknown, and a
 * shorter pause never shortens a running one.
 */
describe("rate-limit.util", () => {
  beforeEach(() => {
    jest.useFakeTimers();
    resetApiReadPause();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  describe("isApiRateLimited", () => {
    it("is true only for a 429 carrying API_RATE_LIMITED", () => {
      expect(isApiRateLimited({ status: 429, code: "API_RATE_LIMITED" })).toBe(
        true
      );
      // The map's bucket is the map's (#705).
      expect(
        isApiRateLimited({ status: 429, code: "MAP_TILE_RATE_LIMITED" })
      ).toBe(false);
      expect(isApiRateLimited({ status: 429, code: "" })).toBe(false);
      expect(isApiRateLimited({ status: 500, code: "API_RATE_LIMITED" })).toBe(
        false
      );
      expect(isApiRateLimited(new Error("network down"))).toBe(false);
      expect(isApiRateLimited(null)).toBe(false);
    });
  });

  describe("retryAfterMs", () => {
    it("converts the error's seconds to milliseconds", () => {
      expect(retryAfterMs({ retryAfterSeconds: 42 })).toBe(42_000);
    });

    it("clamps to [1s, 60s]", () => {
      expect(retryAfterMs({ retryAfterSeconds: 0 })).toBe(1_000);
      expect(retryAfterMs({ retryAfterSeconds: 600 })).toBe(60_000);
    });

    it("defaults to 2s when the wait is unknown", () => {
      expect(retryAfterMs({})).toBe(2_000);
      expect(retryAfterMs({ retryAfterSeconds: Number.NaN })).toBe(2_000);
    });
  });

  describe("pauseApiReads", () => {
    it("starts a pause that runs down with the clock", () => {
      expect(apiReadPauseRemainingMs()).toBe(0);
      pauseApiReads(10_000);
      expect(apiReadPauseRemainingMs()).toBe(10_000);
      jest.advanceTimersByTime(4_000);
      expect(apiReadPauseRemainingMs()).toBe(6_000);
      jest.advanceTimersByTime(6_000);
      expect(apiReadPauseRemainingMs()).toBe(0);
    });

    it("extends a running pause but never shortens it", () => {
      pauseApiReads(10_000);
      pauseApiReads(3_000);
      expect(apiReadPauseRemainingMs()).toBe(10_000);
      pauseApiReads(20_000);
      expect(apiReadPauseRemainingMs()).toBe(20_000);
    });
  });

  describe("waitForApiReadPause", () => {
    it("resolves at once when no pause is running", async () => {
      await expect(waitForApiReadPause()).resolves.toBeUndefined();
    });

    it("resolves only when the pause ends, including an extension", async () => {
      pauseApiReads(5_000);
      let done = false;
      void waitForApiReadPause().then(() => {
        done = true;
      });

      await jest.advanceTimersByTimeAsync(4_000);
      pauseApiReads(5_000); // extended to 5s from now
      await jest.advanceTimersByTimeAsync(2_000);
      expect(done).toBe(false);

      await jest.advanceTimersByTimeAsync(3_000);
      expect(done).toBe(true);
    });
  });
});
