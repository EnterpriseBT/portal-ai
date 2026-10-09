/**
 * #705: map tiles count against their own per-user bucket, mounted ahead of
 * the API limiter, so panning a map can never throttle the rest of the app.
 *
 * Runs against real Redis. jwtCheck is mocked to stamp a per-test Auth0
 * subject on the request — the limiters key on it — and every case uses a
 * fresh subject, so no case inherits another's window. The tile and API
 * requests downstream of the limiters fail for unrelated reasons (no such
 * user or pin); every assertion is about whether the LIMITER refused them.
 */

import {
  jest,
  describe,
  it,
  expect,
  beforeAll,
  afterAll,
  afterEach,
} from "@jest/globals";
import request from "supertest";
import { Request, Response, NextFunction } from "express";
import { Redis } from "ioredis";

import { ApiCode } from "../../../constants/api-codes.constants.js";

// Read by environment.ts at import, so set before the app loads.
process.env.AUTH_TILE_RATE_LIMIT_PER_MIN = "3";
process.env.AUTH_API_RATE_LIMIT_PER_MIN = "2";

let currentSub = "";
jest.unstable_mockModule("../../../middleware/auth.middleware.js", () => ({
  jwtCheck: (req: Request, _res: Response, next: NextFunction) => {
    (req as unknown as { auth: unknown }).auth = {
      payload: { sub: currentSub },
    };
    next();
  },
}));

const { app } = await import("../../../app.js");

const TILE = "/api/portal-map/tiles/pin/no-such-pin/0/0/0.mvt";
const API = "/api/stations";

let redis: Redis;
const usedSubs: string[] = [];

function freshSub(): string {
  currentSub = `auth0|rate-limit-${Date.now()}-${Math.random()}`;
  usedSubs.push(currentSub);
  return currentSub;
}

/** Send `path` until the limiter refuses it; returns the refusal. Bounded so
 *  a broken limiter fails the test rather than looping. */
async function exhaust(path: string) {
  for (let i = 0; i < 10; i++) {
    const res = await request(app).get(path);
    if (res.status === 429) return res;
  }
  throw new Error(`${path} was never rate-limited`);
}

const rateKeys = (bucket: "authed" | "authed-tiles", sub: string) =>
  redis.keys(`usage:rate:${bucket}:${sub}:*`);

beforeAll(async () => {
  redis = new Redis(process.env.REDIS_URL!, { maxRetriesPerRequest: 1 });
});

afterEach(async () => {
  for (const sub of usedSubs.splice(0)) {
    const keys = [
      ...(await rateKeys("authed", sub)),
      ...(await rateKeys("authed-tiles", sub)),
    ];
    if (keys.length > 0) await redis.del(...keys);
  }
});

afterAll(() => {
  redis.disconnect();
});

describe("per-user rate-limit buckets (#705)", () => {
  it("serves tiles after the API bucket is spent", async () => {
    freshSub();
    const refused = await exhaust(API);
    expect(refused.body.code).toBe(ApiCode.API_RATE_LIMITED);
    const retryAfter = Number(refused.headers["retry-after"]);
    expect(retryAfter).toBeGreaterThanOrEqual(1);
    expect(retryAfter).toBeLessThanOrEqual(60);
    expect(refused.body.details).toEqual({ retryAfterSeconds: retryAfter });

    const tile = await request(app).get(TILE);
    expect(tile.status).not.toBe(429);
  });

  it("limits tiles at their own ceiling without touching the API", async () => {
    freshSub();
    const refused = await exhaust(TILE);
    expect(refused.body.code).toBe(ApiCode.API_RATE_LIMITED);
    expect(refused.body.message).toMatch(/^Too many map tile requests\./);
    expect(Number(refused.headers["retry-after"])).toBeGreaterThanOrEqual(1);

    const api = await request(app).get(API);
    expect(api.status).not.toBe(429);
  });

  it("never counts a tile request against the API bucket", async () => {
    const sub = freshSub();
    await request(app).get(TILE);

    expect(await rateKeys("authed-tiles", sub)).toHaveLength(1);
    expect(await rateKeys("authed", sub)).toHaveLength(0);
  });
});
