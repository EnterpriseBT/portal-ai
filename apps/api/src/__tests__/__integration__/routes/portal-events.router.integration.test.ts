import {
  jest,
  describe,
  it,
  expect,
  beforeEach,
  afterEach,
} from "@jest/globals";
import request from "supertest";
import { Request, Response, NextFunction } from "express";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

import * as schema from "../../../db/schema/index.js";
import {
  generateId,
  seedTenancyFixture,
  teardownOrg,
  type TenancyFixture,
} from "../utils/application.util.js";

/**
 * #685 slice 1: the SSE routes resolve the caller and authorize like their
 * REST siblings. Before this, `sseAuth` (a valid JWT) was the only gate, so
 * any authenticated user could replay or drive another user's portal and
 * read another org's job stream.
 *
 * The portal stream is exercised through its replay path (the last message
 * is an assistant reply), which answers without calling the model.
 */

const OWNER_SUB = "auth0|sse-owner";
const MEMBER_SUB = "auth0|sse-member";
const OTHER_SUB = "auth0|sse-other-owner";
let currentSub = OWNER_SUB;

jest.unstable_mockModule("../../../middleware/auth.middleware.js", () => ({
  jwtCheck: (req: Request, _res: Response, next: NextFunction) => {
    req.auth = { payload: { sub: currentSub } } as never;
    next();
  },
}));
jest.unstable_mockModule("../../../services/auth0.service.js", () => ({
  Auth0Service: {
    hasAccessToken: jest.fn(),
    getAccessToken: jest.fn(),
    getAuth0UserProfile: jest.fn(),
  },
}));

const { app } = await import("../../../app.js");

const now = Date.now();
const base = (createdBy: string) => ({
  created: now,
  createdBy,
  updated: null,
  updatedBy: null,
  deleted: null,
  deletedBy: null,
});

describe("SSE authorization (#685)", () => {
  let connection: ReturnType<typeof postgres>;
  let db: ReturnType<typeof drizzle>;
  let fx: TenancyFixture;

  /** A portal owned by `createdBy`, answered (last message = assistant). */
  async function answeredPortal(orgId: string, createdBy: string) {
    const stationId = generateId();
    await db.insert(schema.stations).values({
      id: stationId,
      organizationId: orgId,
      name: `Station ${stationId.slice(0, 6)}`,
      description: null,
      ...base(createdBy),
    } as never);
    const portalId = generateId();
    await db.insert(schema.portals).values({
      id: portalId,
      organizationId: orgId,
      stationId,
      name: "Portal",
      ...base(createdBy),
    } as never);
    // Distinct timestamps: messages are read back in `created` order, and the
    // newest must be the assistant reply for the stream to replay it.
    for (const [i, [role, content]] of (
      [
        ["user", "how many rows?"],
        ["assistant", "secret answer 42"],
      ] as const
    ).entries()) {
      await db.insert(schema.portalMessages).values({
        id: generateId(),
        portalId,
        organizationId: orgId,
        role,
        blocks: [{ type: "text", content }],
        ...base(createdBy),
        created: now + i,
      } as never);
    }
    return portalId;
  }

  async function job(orgId: string, createdBy: string) {
    const id = generateId();
    await db.insert(schema.jobs).values({
      id,
      organizationId: orgId,
      type: "system_check",
      status: "completed",
      progress: 100,
      metadata: {},
      result: null,
      error: null,
      startedAt: null,
      completedAt: now,
      bullJobId: null,
      attempts: 1,
      maxAttempts: 3,
      ...base(createdBy),
    } as never);
    return id;
  }

  const stream = (portalId: string) =>
    request(app).get(`/api/sse/portals/${portalId}/stream?token=x`);

  beforeEach(async () => {
    connection = postgres(process.env.DATABASE_URL as string, { max: 1 });
    db = drizzle(connection, { schema });
    await teardownOrg(db);
    fx = await seedTenancyFixture(db, {
      owner: OWNER_SUB,
      member: MEMBER_SUB,
      otherOwner: OTHER_SUB,
    });
    currentSub = OWNER_SUB;
  });

  afterEach(async () => {
    await connection.end();
  });

  it("the owner replays their own portal's answer", async () => {
    const portalId = await answeredPortal(fx.orgId, fx.ownerId);
    const res = await stream(portalId);
    expect(res.status).toBe(200);
    expect(res.text).toContain("secret answer 42");
  });

  it("a member can't replay another user's portal: 404, nothing leaked", async () => {
    const portalId = await answeredPortal(fx.orgId, fx.ownerId);
    currentSub = MEMBER_SUB;
    const res = await stream(portalId);
    expect(res.status).toBe(404);
    expect(res.body.code).toBe("PORTAL_NOT_FOUND");
    expect(res.text).not.toContain("secret answer 42");
  });

  it("another org's user can't replay the portal: 404", async () => {
    const portalId = await answeredPortal(fx.orgId, fx.ownerId);
    currentSub = OTHER_SUB;
    const res = await stream(portalId);
    expect(res.status).toBe(404);
    expect(res.text).not.toContain("secret answer 42");
  });

  it("a member replays their own portal", async () => {
    const portalId = await answeredPortal(fx.orgId, fx.memberId);
    currentSub = MEMBER_SUB;
    const res = await stream(portalId);
    expect(res.status).toBe(200);
    expect(res.text).toContain("secret answer 42");
  });

  it("the portal events channel refuses a member and another org (404)", async () => {
    const portalId = await answeredPortal(fx.orgId, fx.ownerId);
    for (const sub of [MEMBER_SUB, OTHER_SUB]) {
      currentSub = sub;
      const res = await request(app).get(
        `/api/sse/portals/${portalId}/events?token=x`
      );
      expect(res.status).toBe(404);
      expect(res.body.code).toBe("PORTAL_NOT_FOUND");
    }
  });

  it("job events from another org are a 404; the same org still streams", async () => {
    const id = await job(fx.orgId, fx.ownerId);
    currentSub = OTHER_SUB;
    const refused = await request(app).get(
      `/api/sse/jobs/${id}/events?token=x`
    );
    expect(refused.status).toBe(404);
    expect(refused.body.code).toBe("JOB_NOT_FOUND");

    currentSub = OWNER_SUB;
    const ok = await request(app).get(`/api/sse/jobs/${id}/events?token=x`);
    expect(ok.status).toBe(200);
    expect(ok.text).toContain("event: snapshot");
  });
});
