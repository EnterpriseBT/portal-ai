import { jest, describe, it, expect, beforeEach } from "@jest/globals";
import express from "express";
import request from "supertest";
import type { Request, Response, NextFunction } from "express";

import { ApiCode } from "../../constants/api-codes.constants.js";
import { ApiError, HttpService } from "../../services/http.service.js";

// The readiness handler probes the DB and Redis clients. Mock both so the
// unit test can drive each dependency up/down deterministically without a
// real Postgres or Redis (this is the seam the plan calls for).
const dbExecute = jest.fn<() => Promise<unknown>>();
const redisPing = jest.fn<() => Promise<unknown>>();

jest.unstable_mockModule("../../db/index.js", () => ({
  db: { execute: dbExecute },
}));

jest.unstable_mockModule("../../utils/redis.util.js", () => ({
  getRedisClient: () => ({ ping: redisPing }),
}));

const { healthRouter, checkReadiness } =
  await import("../../routes/health.router.js");

/** Minimal app mounting the real router + the app's error serializer. */
const buildApp = () => {
  const app = express();
  app.use("/api/health", healthRouter);
  app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
    if (err instanceof ApiError) return HttpService.error(res, err);
    return res.status(500).json({ success: false });
  });
  return app;
};

beforeEach(() => {
  dbExecute.mockReset();
  redisPing.mockReset();
});

describe("checkReadiness", () => {
  it("is ready when both dependencies resolve", async () => {
    const result = await checkReadiness({
      pingDb: () => Promise.resolve(),
      pingRedis: () => Promise.resolve(),
    });
    expect(result).toEqual({ ready: true, checks: { db: true, redis: true } });
  });

  it("is not ready and names the DB when the DB probe rejects", async () => {
    const result = await checkReadiness({
      pingDb: () => Promise.reject(new Error("db down")),
      pingRedis: () => Promise.resolve(),
    });
    expect(result).toEqual({
      ready: false,
      checks: { db: false, redis: true },
    });
  });

  it("is not ready and names Redis when the Redis probe rejects", async () => {
    const result = await checkReadiness({
      pingDb: () => Promise.resolve(),
      pingRedis: () => Promise.reject(new Error("redis down")),
    });
    expect(result).toEqual({
      ready: false,
      checks: { db: true, redis: false },
    });
  });

  it("is not ready when both probes reject", async () => {
    const result = await checkReadiness({
      pingDb: () => Promise.reject(new Error("db down")),
      pingRedis: () => Promise.reject(new Error("redis down")),
    });
    expect(result).toEqual({
      ready: false,
      checks: { db: false, redis: false },
    });
  });
});

describe("GET /api/health/ready", () => {
  it("returns 200 with checks when both dependencies are healthy", async () => {
    dbExecute.mockResolvedValue([{ "?column?": 1 }]);
    redisPing.mockResolvedValue("PONG");

    const res = await request(buildApp()).get("/api/health/ready");

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.payload.ready).toBe(true);
    expect(res.body.payload.checks).toEqual({ db: true, redis: true });
    expect(typeof res.body.payload.timestamp).toBe("string");
  });

  it("returns 503 with HEALTH_NOT_READY when the DB is down", async () => {
    dbExecute.mockRejectedValue(new Error("db down"));
    redisPing.mockResolvedValue("PONG");

    const res = await request(buildApp()).get("/api/health/ready");

    expect(res.status).toBe(503);
    expect(res.body.success).toBe(false);
    expect(res.body.code).toBe(ApiCode.HEALTH_NOT_READY);
    expect(res.body.details.ready).toBe(false);
    expect(res.body.details.checks).toEqual({ db: false, redis: true });
  });

  it("returns 503 with HEALTH_NOT_READY when Redis is down", async () => {
    dbExecute.mockResolvedValue([{ "?column?": 1 }]);
    redisPing.mockRejectedValue(new Error("redis down"));

    const res = await request(buildApp()).get("/api/health/ready");

    expect(res.status).toBe(503);
    expect(res.body.code).toBe(ApiCode.HEALTH_NOT_READY);
    expect(res.body.details.checks).toEqual({ db: true, redis: false });
  });
});

describe("GET /api/health (liveness, unchanged)", () => {
  it("returns 200 without touching the DB or Redis", async () => {
    const res = await request(buildApp()).get("/api/health");

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.payload.timestamp).toBeDefined();
    expect(dbExecute).not.toHaveBeenCalled();
    expect(redisPing).not.toHaveBeenCalled();
  });
});
