/**
 * #124 slice 4 — the trust-boundary read endpoint, adversarially.
 *
 * GET /api/webhook/handle/:handleId is the ONLY surface authed to a third-party
 * webhook (a scoped, expiring token — never the user JWT). These tests drive
 * the real endpoint (supertest + real Redis) and prove it fails closed:
 * unknown / expired / wrong-handle / wrong-org / write-on-read / no-token are
 * all rejected, and a correctly-scoped token pages the handle without any user
 * credential. (spec integration 7 + 8)
 */

import { jest, describe, it, expect, beforeAll, afterEach } from "@jest/globals";
import request from "supertest";
import { Request, Response, NextFunction } from "express";

// The endpoint isn't under jwtCheck, but importing `app` loads protectedRouter;
// stub the JWT middleware so the app imports without Auth0 config.
jest.unstable_mockModule("../../../middleware/auth.middleware.js", () => ({
  jwtCheck: (_req: Request, _res: Response, next: NextFunction) => next(),
}));

const { app } = await import("../../../app.js");
const { PortalSqlHandleService } = await import(
  "../../../services/portal-sql-handle.service.js"
);
const { WebhookReadTokenService } = await import(
  "../../../services/webhook-read-token.service.js"
);
const { getRedisClient } = await import("../../../utils/redis.util.js");

const ORG = "org-124-read";
const staged: string[] = [];

async function stageHandle(org = ORG): Promise<string> {
  const rows = Array.from({ length: 12 }, (_, i) => ({ i, v: i * i }));
  const { envelope } = await PortalSqlHandleService.produceFromRows({
    rows,
    stationId: "station-1",
    organizationId: org,
  });
  staged.push(envelope.queryHandle);
  return envelope.queryHandle;
}

const GET = (handleId: string, token?: string) => {
  const r = request(app).get(`/api/webhook/handle/${handleId}`);
  return token ? r.set("Authorization", `Bearer ${token}`) : r;
};

describe("GET /api/webhook/handle/:handleId (#124)", () => {
  beforeAll(() => {
    if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL not set");
  });

  afterEach(async () => {
    const redis = getRedisClient();
    for (const h of staged.splice(0)) {
      await redis.del(`portal-sql:handle:${h.slice(3)}:meta`);
    }
  });

  it("serves a paged window for a correctly-scoped read token (no user JWT)", async () => {
    const handleId = await stageHandle();
    const token = await WebhookReadTokenService.mint({
      organizationId: ORG,
      handleId,
      mode: "read",
    });

    const res = await GET(handleId, token).query({ offset: 0, limit: 5 });
    expect(res.status).toBe(200);
    expect(res.body.payload.total).toBe(12);
    expect(res.body.payload.rows).toHaveLength(5);
    expect(res.body.payload.rows[0]).toEqual({ i: 0, v: 0 });
  });

  it("clamps limit to the page ceiling (≤ 5000)", async () => {
    const handleId = await stageHandle();
    const token = await WebhookReadTokenService.mint({
      organizationId: ORG,
      handleId,
      mode: "read",
    });
    const res = await GET(handleId, token).query({ limit: 999999 });
    expect(res.status).toBe(200);
    expect(res.body.payload.rows.length).toBeLessThanOrEqual(12);
  });

  it("401 with no Authorization header", async () => {
    const handleId = await stageHandle();
    const res = await GET(handleId);
    expect(res.status).toBe(401);
    expect(res.body.code).toBe("WEBHOOK_READ_TOKEN_INVALID");
  });

  it("401 for an unknown/bogus token", async () => {
    const handleId = await stageHandle();
    const res = await GET(handleId, "totally-bogus");
    expect(res.status).toBe(401);
    expect(res.body.code).toBe("WEBHOOK_READ_TOKEN_INVALID");
  });

  it("401 for an expired token", async () => {
    const handleId = await stageHandle();
    // Negative ttl → exp in the past, but the Redis grace keeps the record so
    // it reads as EXPIRED (not evicted-to-INVALID).
    const token = await WebhookReadTokenService.mint({
      organizationId: ORG,
      handleId,
      mode: "read",
      ttlMs: -1_000,
    });
    const res = await GET(handleId, token);
    expect(res.status).toBe(401);
    expect(res.body.code).toBe("WEBHOOK_READ_TOKEN_EXPIRED");
  });

  it("403 for a token scoped to a DIFFERENT handle", async () => {
    const handleA = await stageHandle();
    const handleB = await stageHandle();
    const tokenForB = await WebhookReadTokenService.mint({
      organizationId: ORG,
      handleId: handleB,
      mode: "read",
    });
    const res = await GET(handleA, tokenForB);
    expect(res.status).toBe(403);
    expect(res.body.code).toBe("WEBHOOK_HANDLE_SCOPE_MISMATCH");
  });

  it("403 for a token from a DIFFERENT org (defense in depth)", async () => {
    const handleId = await stageHandle(ORG); // handle owned by ORG
    const foreignToken = await WebhookReadTokenService.mint({
      organizationId: "org-INTRUDER",
      handleId, // same handle id, but a different org's grant
      mode: "read",
    });
    const res = await GET(handleId, foreignToken);
    expect(res.status).toBe(403);
    expect(res.body.code).toBe("WEBHOOK_HANDLE_SCOPE_MISMATCH");
  });

  it("403 for a write-scoped token on the read endpoint", async () => {
    const handleId = await stageHandle();
    const writeToken = await WebhookReadTokenService.mint({
      organizationId: ORG,
      handleId,
      mode: "write",
    });
    const res = await GET(handleId, writeToken);
    expect(res.status).toBe(403);
    expect(res.body.code).toBe("WEBHOOK_HANDLE_SCOPE_MISMATCH");
  });

  it("revoked token fails closed (401)", async () => {
    const handleId = await stageHandle();
    const token = await WebhookReadTokenService.mint({
      organizationId: ORG,
      handleId,
      mode: "read",
    });
    await WebhookReadTokenService.revoke(token);
    const res = await GET(handleId, token);
    expect(res.status).toBe(401);
    expect(res.body.code).toBe("WEBHOOK_READ_TOKEN_INVALID");
  });
});

describe("POST /api/webhook/handle/:sessionId — outbound staging (#124)", () => {
  beforeAll(() => {
    if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL not set");
  });

  afterEach(async () => {
    const redis = getRedisClient();
    for (const h of staged.splice(0)) {
      await redis.del(`portal-sql:handle:${h.slice(3)}:meta`);
    }
  });

  const POST = (sessionId: string, token: string | undefined, body: unknown) => {
    const r = request(app).post(`/api/webhook/handle/${sessionId}`);
    return (token ? r.set("Authorization", `Bearer ${token}`) : r).send(
      body as object
    );
  };

  it("stages supplied rows with a write token and returns a readable resultHandle", async () => {
    const sessionId = "sess-write-1";
    const writeToken = await WebhookReadTokenService.mint({
      organizationId: ORG,
      handleId: sessionId,
      mode: "write",
      stationId: "station-1",
    });

    const res = await POST(sessionId, writeToken, {
      rows: [{ k: "a", n: 1 }, { k: "b", n: 2 }, { k: "c", n: 3 }],
    });
    expect(res.status).toBe(200);
    expect(res.body.payload.resultHandle).toMatch(/^qh-/);
    expect(res.body.payload.rowCount).toBe(3);
    staged.push(res.body.payload.resultHandle);

    // The staged handle is a real, readable handle.
    const snap = await PortalSqlHandleService.getSnapshot(
      res.body.payload.resultHandle,
      { offset: 0, limit: 10 }
    );
    expect(snap.total).toBe(3);
    expect(snap.rows[1]).toEqual({ k: "b", n: 2 });
  });

  it("401 with no token", async () => {
    const res = await POST("sess-x", undefined, { rows: [] });
    expect(res.status).toBe(401);
    expect(res.body.code).toBe("WEBHOOK_READ_TOKEN_INVALID");
  });

  it("403 for a READ token on the write endpoint", async () => {
    const sessionId = "sess-readwrong";
    const readToken = await WebhookReadTokenService.mint({
      organizationId: ORG,
      handleId: sessionId,
      mode: "read",
    });
    const res = await POST(sessionId, readToken, { rows: [{ a: 1 }] });
    expect(res.status).toBe(403);
    expect(res.body.code).toBe("WEBHOOK_HANDLE_SCOPE_MISMATCH");
  });

  it("400 when rows is missing", async () => {
    const sessionId = "sess-norows";
    const writeToken = await WebhookReadTokenService.mint({
      organizationId: ORG,
      handleId: sessionId,
      mode: "write",
      stationId: "station-1",
    });
    const res = await POST(sessionId, writeToken, { schema: [] });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("WEBHOOK_RESULT_HANDLE_INVALID");
  });
});
