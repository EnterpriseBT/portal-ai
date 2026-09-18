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
jest.unstable_mockModule("../../utils/rate-limit.util.js", () => ({
  incrementRateWindow: mockIncrement,
}));

const { authenticatedRateLimit } =
  await import("../../middleware/authenticated-rate-limit.middleware.js");
const { ApiError } = await import("../../services/http.service.js");
const { ApiCode } = await import("../../constants/api-codes.constants.js");

// ── Fixtures ─────────────────────────────────────────────────────────

const reqFor = (sub: string | undefined) =>
  ({ auth: sub ? { payload: { sub } } : undefined }) as unknown as Request;
const res = {} as Response;

beforeEach(() => {
  mockIncrement.mockReset();
});

// ── case 1 — under the limit passes through, keyed by subject ─────────

it("calls next() with no error while under the limit, keyed by the Auth0 sub", async () => {
  mockIncrement.mockResolvedValue(3);
  const next = jest.fn();

  await authenticatedRateLimit(300)(reqFor("auth0|user-a"), res, next);

  expect(mockIncrement).toHaveBeenCalledWith("authed:auth0|user-a");
  expect(next).toHaveBeenCalledWith();
});

// ── case 2 — over the limit denies 429 ───────────────────────────────

it("denies 429 API_RATE_LIMITED when the window count exceeds the limit", async () => {
  mockIncrement.mockResolvedValue(301);
  const next = jest.fn();

  await authenticatedRateLimit(300)(reqFor("auth0|user-a"), res, next);

  const err = next.mock.calls[0][0] as InstanceType<typeof ApiError>;
  expect(err).toBeInstanceOf(ApiError);
  expect(err.status).toBe(429);
  expect(err.code).toBe(ApiCode.API_RATE_LIMITED);
});

// ── case 3 — principals are counted independently ────────────────────

it("keys each subject into its own window so one principal's limit doesn't affect another", async () => {
  const next = jest.fn();
  await authenticatedRateLimit(300)(reqFor("auth0|user-a"), res, next);
  await authenticatedRateLimit(300)(reqFor("auth0|user-b"), res, next);

  expect(mockIncrement).toHaveBeenNthCalledWith(1, "authed:auth0|user-a");
  expect(mockIncrement).toHaveBeenNthCalledWith(2, "authed:auth0|user-b");
});

// ── case 4 — Redis failure fails OPEN ────────────────────────────────

it("fails open (passes the request) when the Redis counter errors", async () => {
  mockIncrement.mockRejectedValue(new Error("redis down"));
  const next = jest.fn();

  await authenticatedRateLimit(300)(reqFor("auth0|user-a"), res, next);

  expect(next).toHaveBeenCalledWith();
});

// ── case 5 — missing subject allows (never a shared bucket) ───────────

it("allows the request without touching Redis when the subject is absent", async () => {
  const next = jest.fn();

  await authenticatedRateLimit(300)(reqFor(undefined), res, next);

  expect(mockIncrement).not.toHaveBeenCalled();
  expect(next).toHaveBeenCalledWith();
});
