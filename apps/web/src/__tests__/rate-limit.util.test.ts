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
  onApiRateLimitWindow,
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
    // No release spread unless a test asks for one.
    jest.spyOn(Math, "random").mockReturnValue(0);
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
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

    it("spreads the release so held reads don't leave together", async () => {
      jest.spyOn(Math, "random").mockReturnValue(0.5);
      pauseApiReads(5_000);
      let done = false;
      void waitForApiReadPause().then(() => {
        done = true;
      });

      await jest.advanceTimersByTimeAsync(5_000);
      expect(done).toBe(false);
      await jest.advanceTimersByTimeAsync(1_500);
      expect(done).toBe(true);
    });

    it("rejects with AbortError when its read is abandoned", async () => {
      pauseApiReads(5_000);
      const controller = new AbortController();
      const waiting = waitForApiReadPause(controller.signal);
      controller.abort();
      await expect(waiting).rejects.toMatchObject({ name: "AbortError" });
    });
  });
});

describe("onApiRateLimitWindow (#747)", () => {
  beforeEach(() => {
    jest.useFakeTimers();
    resetApiReadPause();
    // No release spread unless a test asks for one.
    jest.spyOn(Math, "random").mockReturnValue(0);
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  it("hears each new window once, with its wait", () => {
    const listener = jest.fn();
    const unsubscribe = onApiRateLimitWindow(listener);

    pauseApiReads(30_000);
    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener).toHaveBeenCalledWith({ waitMs: 30_000, extended: false });

    jest.advanceTimersByTime(30_000);
    pauseApiReads(5_000);
    expect(listener).toHaveBeenCalledTimes(2);
    expect(listener).toHaveBeenLastCalledWith({
      waitMs: 5_000,
      extended: false,
    });

    unsubscribe();
    jest.advanceTimersByTime(5_000);
    pauseApiReads(5_000);
    expect(listener).toHaveBeenCalledTimes(2);
  });

  // #747 adversarial §3.1: a longer refusal inside a running window held
  // reads for 31s while the notice still said 5s and hid at 5s.
  it("hears an extension of the running window, with the new wait", () => {
    const listener = jest.fn();
    const unsubscribe = onApiRateLimitWindow(listener);

    pauseApiReads(5_000);
    jest.advanceTimersByTime(1_000);
    pauseApiReads(30_000);
    expect(listener).toHaveBeenCalledTimes(2);
    expect(listener).toHaveBeenLastCalledWith({
      waitMs: 30_000,
      extended: true,
    });

    unsubscribe();
  });

  it("ignores a refusal that doesn't lengthen the wait by much", () => {
    const listener = jest.fn();
    const unsubscribe = onApiRateLimitWindow(listener);

    // Parallel refusals from one window name the same end, give or take a
    // second of rounding; each would otherwise replace the notice.
    pauseApiReads(30_000);
    pauseApiReads(10_000);
    pauseApiReads(31_000);
    expect(listener).toHaveBeenCalledTimes(1);

    unsubscribe();
  });

  it("keeps a throwing listener from breaking the pause or the others", () => {
    const after = jest.fn();
    const unsubscribeThrowing = onApiRateLimitWindow(() => {
      throw new Error("toast broke");
    });
    const unsubscribeAfter = onApiRateLimitWindow(after);

    expect(() => pauseApiReads(10_000)).not.toThrow();
    expect(apiReadPauseRemainingMs()).toBe(10_000);
    expect(after).toHaveBeenCalledWith({ waitMs: 10_000, extended: false });

    unsubscribeThrowing();
    unsubscribeAfter();
  });
});
