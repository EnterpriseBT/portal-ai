import {
  jest,
  describe,
  it,
  expect,
  beforeEach,
  afterEach,
} from "@jest/globals";

import { ApiCode } from "../../../constants/api-codes.constants.js";
import { ApiError } from "../../../services/http.service.js";
import {
  withRetry,
  DEFAULT_RETRY_POLICY,
  type RetryPolicy,
} from "../../../adapters/rest-api/retry.util.js";

beforeEach(() => {
  jest.useFakeTimers();
});

afterEach(() => {
  jest.useRealTimers();
});

function fetchFailedError(
  status: number,
  headers: Record<string, string> = {}
): ApiError {
  return new ApiError(
    502,
    ApiCode.REST_API_FETCH_FAILED,
    `Endpoint returned HTTP ${status}`,
    { status, headers, url: "https://x.test" }
  );
}

describe("withRetry — happy paths", () => {
  it("returns on the first call when fn succeeds", async () => {
    const fn = jest.fn<() => Promise<string>>().mockResolvedValueOnce("ok");
    const result = await withRetry(fn);
    expect(result).toBe("ok");
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("retries with exponential backoff (250ms, 500ms) and succeeds on the 3rd attempt", async () => {
    const fn = jest
      .fn<() => Promise<string>>()
      .mockRejectedValueOnce(fetchFailedError(502))
      .mockRejectedValueOnce(fetchFailedError(502))
      .mockResolvedValueOnce("ok");

    const onRetry = jest.fn();
    const promise = withRetry(fn, DEFAULT_RETRY_POLICY, { onRetry });

    // First failure → wait 250ms.
    await jest.advanceTimersByTimeAsync(250);
    // Second failure → wait 500ms.
    await jest.advanceTimersByTimeAsync(500);

    await expect(promise).resolves.toBe("ok");
    expect(fn).toHaveBeenCalledTimes(3);

    expect(onRetry).toHaveBeenCalledTimes(2);
    expect(onRetry).toHaveBeenNthCalledWith(1, 1, 250, 502);
    expect(onRetry).toHaveBeenNthCalledWith(2, 2, 500, 502);
  });

  it("honors a numeric Retry-After header on 429", async () => {
    const fn = jest
      .fn<() => Promise<string>>()
      .mockRejectedValueOnce(fetchFailedError(429, { "retry-after": "3" }))
      .mockResolvedValueOnce("ok");

    const promise = withRetry(fn);
    await jest.advanceTimersByTimeAsync(3_000);
    await expect(promise).resolves.toBe("ok");
  });

  it("honors an HTTP-date Retry-After (~2s in the future)", async () => {
    const fixedNow = new Date("2026-05-23T12:00:00.000Z").getTime();
    jest.setSystemTime(fixedNow);
    const inTwoSeconds = new Date(fixedNow + 2_000).toUTCString();

    const fn = jest
      .fn<() => Promise<string>>()
      .mockRejectedValueOnce(
        fetchFailedError(429, { "retry-after": inTwoSeconds })
      )
      .mockResolvedValueOnce("ok");

    const promise = withRetry(fn);
    await jest.advanceTimersByTimeAsync(2_000);
    await expect(promise).resolves.toBe("ok");
  });

  it("falls back to exp backoff on an unparseable Retry-After", async () => {
    const fn = jest
      .fn<() => Promise<string>>()
      .mockRejectedValueOnce(
        fetchFailedError(429, { "retry-after": "soon-ish" })
      )
      .mockResolvedValueOnce("ok");

    const onRetry = jest.fn();
    const promise = withRetry(fn, DEFAULT_RETRY_POLICY, { onRetry });
    await jest.advanceTimersByTimeAsync(250);
    await expect(promise).resolves.toBe("ok");
    // First retry's delay is base 250 since the header was unparseable.
    expect(onRetry).toHaveBeenCalledWith(1, 250, 429);
  });
});

describe("withRetry — error paths", () => {
  it("rethrows non-retryable status (e.g. 400) without retrying", async () => {
    const fn = jest
      .fn<() => Promise<string>>()
      .mockRejectedValue(fetchFailedError(400));

    await expect(withRetry(fn)).rejects.toMatchObject({
      code: ApiCode.REST_API_FETCH_FAILED,
      details: expect.objectContaining({ status: 400 }),
    });
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("rethrows non-ApiError throws without retrying", async () => {
    const fn = jest
      .fn<() => Promise<string>>()
      .mockRejectedValue(new Error("plain"));

    await expect(withRetry(fn)).rejects.toThrow(/plain/);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("after maxRetries on 5xx, rethrows REST_API_FETCH_FAILED with details.attempts", async () => {
    const fn = jest
      .fn<() => Promise<string>>()
      .mockRejectedValue(fetchFailedError(502));

    const policy: RetryPolicy = { ...DEFAULT_RETRY_POLICY, maxRetries: 5 };
    const promise = withRetry(fn, policy);
    promise.catch(() => {}); // prevent unhandled rejection warning while we step

    // 5 backoffs: 250, 500, 1000, 2000, 4000 (each capped at maxDelayMs).
    await jest.advanceTimersByTimeAsync(250);
    await jest.advanceTimersByTimeAsync(500);
    await jest.advanceTimersByTimeAsync(1_000);
    await jest.advanceTimersByTimeAsync(2_000);
    await jest.advanceTimersByTimeAsync(4_000);

    await expect(promise).rejects.toMatchObject({
      code: ApiCode.REST_API_FETCH_FAILED,
      details: expect.objectContaining({ attempts: 6, status: 502 }),
    });
    expect(fn).toHaveBeenCalledTimes(6);
  });

  it("after maxRetries on 429, rethrows REST_API_RATE_LIMITED with details.attempts and lastRetryAfter", async () => {
    const fn = jest
      .fn<() => Promise<string>>()
      .mockRejectedValue(fetchFailedError(429, { "retry-after": "1" }));

    const policy: RetryPolicy = { ...DEFAULT_RETRY_POLICY, maxRetries: 2 };
    const promise = withRetry(fn, policy);
    promise.catch(() => {});

    await jest.advanceTimersByTimeAsync(1_000);
    await jest.advanceTimersByTimeAsync(1_000);

    await expect(promise).rejects.toMatchObject({
      code: ApiCode.REST_API_RATE_LIMITED,
      details: expect.objectContaining({
        attempts: 3,
        lastRetryAfter: "1",
      }),
    });
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it("clamps a misbehaving Retry-After to 2 × maxDelayMs", async () => {
    // upstream says wait 60s but maxDelayMs is 8s; clamp at 16s.
    const fn = jest
      .fn<() => Promise<string>>()
      .mockRejectedValueOnce(fetchFailedError(429, { "retry-after": "60" }))
      .mockResolvedValueOnce("ok");

    const onRetry = jest.fn();
    const promise = withRetry(fn, DEFAULT_RETRY_POLICY, { onRetry });
    await jest.advanceTimersByTimeAsync(16_000);
    await expect(promise).resolves.toBe("ok");
    expect(onRetry).toHaveBeenCalledWith(1, 16_000, 429);
  });
});
