/**
 * publicRateLimit middleware (#311 slice 3) — per-IP fixed-window throttle
 * for the anonymous public router, over the cost gate's Redis counter.
 * Fail-OPEN on Redis errors (conscious, recorded: a marketing-page fetch
 * must not 500 on a Redis blip; the SSM/Stripe TTL caches bound origin
 * load regardless).
 */

import { jest, it, expect, beforeEach } from "@jest/globals";
import type { Request, Response } from "express";

// ── Mocks ────────────────────────────────────────────────────────────

const mockIncrement = jest.fn<(key: string, now?: number) => Promise<number>>();
jest.unstable_mockModule("../../utils/rate-limit.util.js", () => ({
  incrementRateWindow: mockIncrement,
}));

const { publicRateLimit } =
  await import("../../middleware/public-rate-limit.middleware.js");
const { ApiError } = await import("../../services/http.service.js");
const { ApiCode } = await import("../../constants/api-codes.constants.js");

// ── Fixtures ─────────────────────────────────────────────────────────

const req = { ip: "203.0.113.7" } as Request;
const res = {} as Response;

beforeEach(() => {
  mockIncrement.mockReset();
});

// ── case 1 — under the limit passes through ──────────────────────────

it("calls next() with no error while under the limit, keyed by IP", async () => {
  mockIncrement.mockResolvedValue(3);
  const next = jest.fn();

  await publicRateLimit(60)(req, res, next);

  expect(mockIncrement).toHaveBeenCalledWith("public-site:203.0.113.7");
  expect(next).toHaveBeenCalledWith();
});

// ── case 2 — over the limit denies 429 ───────────────────────────────

it("denies 429 SITE_CONFIG_RATE_LIMITED when the window count exceeds the limit", async () => {
  mockIncrement.mockResolvedValue(61);
  const next = jest.fn();

  await publicRateLimit(60)(req, res, next);

  const err = next.mock.calls[0][0] as InstanceType<typeof ApiError>;
  expect(err).toBeInstanceOf(ApiError);
  expect(err.status).toBe(429);
  expect(err.code).toBe(ApiCode.SITE_CONFIG_RATE_LIMITED);
});

// ── case 3 — Redis failure fails OPEN ────────────────────────────────

it("fails open (passes the request) when the Redis counter errors", async () => {
  mockIncrement.mockRejectedValue(new Error("redis down"));
  const next = jest.fn();

  await publicRateLimit(60)(req, res, next);

  expect(next).toHaveBeenCalledWith();
});
