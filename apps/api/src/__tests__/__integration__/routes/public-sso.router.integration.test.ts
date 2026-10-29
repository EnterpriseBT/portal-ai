/**
 * Integration tests for `POST /api/public/sso-discovery` (#916): the
 * anonymous lookup behind "Sign in with SSO". jwtCheck is mocked to REJECT
 * everything, so a 200 proves the route escapes auth by mount position. The
 * answer carries only a connection name, never user or org data.
 */

import {
  jest,
  describe,
  it,
  expect,
  beforeEach,
  afterAll,
} from "@jest/globals";
import request from "supertest";
import { Response } from "express";
import { Redis } from "ioredis";

import { ApiCode } from "../../../constants/api-codes.constants.js";

// Read before environment.ts loads. 65 attempts against a 30/min window
// guarantee a 429 even if a minute boundary splits the flood.
process.env.PUBLIC_SSO_RATE_LIMIT_PER_MIN = "30";
process.env.SSO_ENTERPRISE_CONNECTIONS = JSON.stringify([
  { connection: "acme-okta", domains: ["acme.com"] },
]);

jest.unstable_mockModule("../../../middleware/auth.middleware.js", () => ({
  jwtCheck: (_req: unknown, res: Response) => res.status(401).end(),
}));

const { app } = await import("../../../app.js");

/** Drop the public rate-limit keys so each case starts at zero. The
 *  counters are shared Redis keys (`usage:rate:public-<bucket>:<ip>:…`). */
async function clearPublicWindows(): Promise<void> {
  const redis = new Redis(process.env.REDIS_URL!, {
    maxRetriesPerRequest: 1,
    lazyConnect: true,
  });
  try {
    await redis.connect();
    const keys = await redis.keys("usage:rate:public-*");
    if (keys.length) await redis.del(...keys);
  } catch {
    // Redis unreachable: the limiter fails open anyway.
  } finally {
    redis.disconnect();
  }
}

const discover = (body: unknown) =>
  request(app)
    .post("/api/public/sso-discovery")
    .set("content-type", "application/json")
    .send(JSON.stringify(body));

describe("POST /api/public/sso-discovery (#916)", () => {
  beforeEach(clearPublicWindows);
  afterAll(clearPublicWindows);

  it("answers a listed domain's connection without a token", async () => {
    const res = await discover({ email: "Jo@Acme.com" });

    expect(res.status).toBe(200);
    expect(res.body.payload).toEqual({ connection: "acme-okta" });
    expect(res.headers["cache-control"]).toBe("no-store");
  });

  it("answers null for an unlisted domain", async () => {
    const res = await discover({ email: "jo@globex.io" });

    expect(res.status).toBe(200);
    expect(res.body.payload).toEqual({ connection: null });
  });

  it("refuses a malformed email with SSO_DISCOVERY_INVALID_PAYLOAD", async () => {
    const res = await discover({ email: "not-an-email" });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe(ApiCode.SSO_DISCOVERY_INVALID_PAYLOAD);
  });

  it("refuses an unknown body key", async () => {
    const res = await discover({ email: "jo@acme.com", tenant: "acme" });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe(ApiCode.SSO_DISCOVERY_INVALID_PAYLOAD);
  });

  it("rate-limits per IP with its own code and window", async () => {
    const statuses: number[] = [];
    let limitedCode: string | undefined;
    for (let i = 0; i < 65; i++) {
      const res = await discover({ email: "jo@acme.com" });
      statuses.push(res.status);
      if (res.status === 429) limitedCode = res.body.code;
    }
    expect(statuses).toContain(429);
    expect(limitedCode).toBe(ApiCode.SSO_DISCOVERY_RATE_LIMITED);

    // site-config counts in its own window, so the SSO flood didn't spend it.
    const site = await request(app).get("/api/public/site-config");
    expect(site.status).not.toBe(429);
  });
});
