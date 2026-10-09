/**
 * authenticatedRateLimit middleware (#574) — per-user fixed-window throttle
 * for the authenticated API, over the cost gate's Redis counter. Keyed by the
 * Auth0 subject; fail-OPEN on Redis errors (conscious, recorded: a Redis blip
 * must not deny a customer's whole authenticated API).
 */

import { jest, it, expect, beforeEach } from "@jest/globals";
import type { Request, Response } from "express";

// ── Mocks ────────────────────────────────────────────────────────────

const mockIncrement = jest.fn<(key: string, now?: number) => Promise<number>>();
const mockSecondsLeft = jest.fn<(windowMs: number, now?: number) => number>();
jest.unstable_mockModule("../../utils/rate-limit.util.js", () => ({
  incrementRateWindow: mockIncrement,
  secondsUntilWindowEnd: mockSecondsLeft,
  RATE_WINDOW_MS: 60_000,
}));

const mockWarn = jest.fn();
jest.unstable_mockModule("../../utils/logger.util.js", () => ({
  createLogger: () => ({ warn: mockWarn, info: jest.fn(), error: jest.fn() }),
}));

const { authenticatedRateLimit } =
  await import("../../middleware/authenticated-rate-limit.middleware.js");
const { ApiError } = await import("../../services/http.service.js");
const { ApiCode } = await import("../../constants/api-codes.constants.js");

// ── Fixtures ─────────────────────────────────────────────────────────

const API = { bucket: "api", limitPerMinute: 300 } as const;
const TILES = { bucket: "tiles", limitPerMinute: 1200 } as const;

const reqFor = (sub: string | undefined) =>
  ({ auth: sub ? { payload: { sub } } : undefined }) as unknown as Request;
const setHeader = jest.fn();
const res = { setHeader } as unknown as Response;

beforeEach(() => {
  mockIncrement.mockReset();
  mockSecondsLeft.mockReset();
  mockSecondsLeft.mockReturnValue(42);
  setHeader.mockReset();
  mockWarn.mockReset();
});

// ── case 1 — under the limit passes through, keyed by subject ─────────

it("calls next() with no error while under the limit, keyed by the Auth0 sub", async () => {
  mockIncrement.mockResolvedValue(3);
  const next = jest.fn();

  await authenticatedRateLimit(API)(reqFor("auth0|user-a"), res, next);

  expect(mockIncrement).toHaveBeenCalledWith(
    "authed:auth0|user-a",
    expect.any(Number)
  );
  expect(next).toHaveBeenCalledWith();
});

// ── case 2 — over the limit denies 429 ───────────────────────────────

it("denies 429 API_RATE_LIMITED when the window count exceeds the limit", async () => {
  mockIncrement.mockResolvedValue(301);
  const next = jest.fn();

  await authenticatedRateLimit(API)(reqFor("auth0|user-a"), res, next);

  const err = next.mock.calls[0][0] as InstanceType<typeof ApiError>;
  expect(err).toBeInstanceOf(ApiError);
  expect(err.status).toBe(429);
  expect(err.code).toBe(ApiCode.API_RATE_LIMITED);
});

// ── case 3 — principals are counted independently ────────────────────

it("keys each subject into its own window so one principal's limit doesn't affect another", async () => {
  const next = jest.fn();
  await authenticatedRateLimit(API)(reqFor("auth0|user-a"), res, next);
  await authenticatedRateLimit(API)(reqFor("auth0|user-b"), res, next);

  expect(mockIncrement).toHaveBeenNthCalledWith(
    1,
    "authed:auth0|user-a",
    expect.any(Number)
  );
  expect(mockIncrement).toHaveBeenNthCalledWith(
    2,
    "authed:auth0|user-b",
    expect.any(Number)
  );
});

// ── case 4 — Redis failure fails OPEN ────────────────────────────────

it("fails open (passes the request) when the Redis counter errors", async () => {
  mockIncrement.mockRejectedValue(new Error("redis down"));
  const next = jest.fn();

  await authenticatedRateLimit(API)(reqFor("auth0|user-a"), res, next);

  expect(next).toHaveBeenCalledWith();
});

// ── case 5 — missing subject allows (never a shared bucket) ───────────

it("allows the request without touching Redis when the subject is absent", async () => {
  const next = jest.fn();

  await authenticatedRateLimit(API)(reqFor(undefined), res, next);

  expect(mockIncrement).not.toHaveBeenCalled();
  expect(next).toHaveBeenCalledWith();
});

// ── case 6 — a refusal says when to come back (#705) ─────────────────

it("sets Retry-After to the seconds left in the window the request was counted in", async () => {
  mockIncrement.mockResolvedValue(301);
  const next = jest.fn();

  await authenticatedRateLimit(API)(reqFor("auth0|user-a"), res, next);

  // The same instant feeds the counter and the remainder, so the hint matches
  // the window the request was counted in.
  const countedAt = mockIncrement.mock.calls[0][1];
  expect(mockSecondsLeft).toHaveBeenCalledWith(60_000, countedAt);
  expect(setHeader).toHaveBeenCalledWith("Retry-After", "42");
  const err = next.mock.calls[0][0] as InstanceType<typeof ApiError>;
  expect(err.details).toEqual({ retryAfterSeconds: 42 });
  expect(err.message).toBe("Too many requests. Try again in 42 seconds.");
});

it("says 1 second, singular", async () => {
  mockIncrement.mockResolvedValue(301);
  mockSecondsLeft.mockReturnValue(1);
  const next = jest.fn();

  await authenticatedRateLimit(API)(reqFor("auth0|user-a"), res, next);

  const err = next.mock.calls[0][0] as InstanceType<typeof ApiError>;
  expect(err.message).toBe("Too many requests. Try again in 1 second.");
});

it("sets no Retry-After on an allowed request", async () => {
  mockIncrement.mockResolvedValue(300);
  const next = jest.fn();

  await authenticatedRateLimit(API)(reqFor("auth0|user-a"), res, next);

  expect(setHeader).not.toHaveBeenCalled();
  expect(next).toHaveBeenCalledWith();
});

// ── case 7 — tiles count in their own bucket (#705) ──────────────────

it("keys the tiles bucket apart from the API bucket", async () => {
  mockIncrement.mockResolvedValue(1);
  const next = jest.fn();

  await authenticatedRateLimit(TILES)(reqFor("auth0|user-a"), res, next);

  expect(mockIncrement).toHaveBeenCalledWith(
    "authed-tiles:auth0|user-a",
    expect.any(Number)
  );
  expect(next).toHaveBeenCalledWith();
});

it("limits the tiles bucket at its own ceiling, naming map tiles", async () => {
  const next = jest.fn();
  mockIncrement.mockResolvedValue(1200);
  await authenticatedRateLimit(TILES)(reqFor("auth0|user-a"), res, next);
  expect(next).toHaveBeenLastCalledWith();

  mockIncrement.mockResolvedValue(1201);
  await authenticatedRateLimit(TILES)(reqFor("auth0|user-a"), res, next);
  const err = next.mock.calls[1][0] as InstanceType<typeof ApiError>;
  expect(err.status).toBe(429);
  expect(err.code).toBe(ApiCode.API_RATE_LIMITED);
  expect(err.message).toBe(
    "Too many map tile requests. Try again in 42 seconds."
  );
  expect(setHeader).toHaveBeenCalledWith("Retry-After", "42");
});

it("fails open per bucket, naming the bucket in the warning", async () => {
  mockIncrement.mockRejectedValue(new Error("redis down"));
  const next = jest.fn();

  await authenticatedRateLimit(TILES)(reqFor("auth0|user-a"), res, next);

  expect(next).toHaveBeenCalledWith();
  expect(mockWarn).toHaveBeenCalledWith(
    expect.objectContaining({ bucket: "tiles", sub: "auth0|user-a" }),
    expect.any(String)
  );
});
