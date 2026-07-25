/**
 * Integration tests for POST /api/portal-sql/widget-refresh (#270 slice 2):
 * reference-based, org-scoped, rate-limited re-execution of a persisted d3
 * widget's durable pipeline, through the real app mount. Auth is stubbed
 * (jwtCheck injects the caller's auth0 id); the SQL re-executes for real.
 */

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
import { ApiCode } from "../../../constants/api-codes.constants.js";
import { VIZ_REFRESH_RATE_PER_MIN } from "@portalai/core/constants";
import { getRedisClient } from "../../../utils/redis.util.js";
import {
  generateId,
  createUser,
  createOrganization,
  createOrganizationUser,
  teardownOrg,
} from "../utils/application.util.js";

let currentAuth0Id: string | null = null;
jest.unstable_mockModule("../../../middleware/auth.middleware.js", () => ({
  jwtCheck: (req: Request, res: Response, next: NextFunction) => {
    if (!currentAuth0Id) return res.status(401).end();
    req.auth = { payload: { sub: currentAuth0Id } } as never;
    next();
  },
}));

const { app } = await import("../../../app.js");

const OWNER_AUTH0 = `auth0|viz-owner-${generateId().slice(0, 8)}`;
const OTHER_AUTH0 = `auth0|viz-other-${generateId().slice(0, 8)}`;

const PIPELINE_SQL = "SELECT 1 AS n";

describe("POST /api/portal-sql/widget-refresh", () => {
  let connection!: ReturnType<typeof postgres>;
  let db!: ReturnType<typeof drizzle>;
  let orgId!: string;
  let messageId!: string;

  beforeEach(async () => {
    if (!process.env.DATABASE_URL) {
      throw new Error("DATABASE_URL not set - setup.ts should have set this");
    }
    connection = postgres(process.env.DATABASE_URL, { max: 1 });
    db = drizzle(connection, { schema });
    await teardownOrg(db);

    const owner = createUser(OWNER_AUTH0);
    const other = createUser(OTHER_AUTH0);
    await db.insert(schema.users).values([owner, other] as never);

    const org = createOrganization(owner.id);
    const otherOrg = createOrganization(other.id);
    orgId = org.id;
    await db.insert(schema.organizations).values([org, otherOrg] as never);
    await db
      .insert(schema.organizationUsers)
      .values([
        createOrganizationUser(org.id, owner.id),
        createOrganizationUser(otherOrg.id, other.id),
      ] as never);

    const now = Date.now();
    const station = {
      id: generateId(),
      created: now,
      createdBy: owner.id,
      organizationId: orgId,
      name: "Viz station",
    };
    await db.insert(schema.stations).values(station as never);

    const portal = {
      id: generateId(),
      created: now,
      createdBy: owner.id,
      organizationId: orgId,
      stationId: station.id,
      name: "Viz portal",
    };
    await db.insert(schema.portals).values(portal as never);

    messageId = generateId();
    await db.insert(schema.portalMessages).values({
      id: messageId,
      created: now,
      createdBy: owner.id,
      organizationId: orgId,
      portalId: portal.id,
      role: "assistant",
      blocks: [
        { type: "text", content: "here's your chart" },
        {
          type: "d3",
          program: "api.d3.select(api.container);",
          pipeline: {
            sql: PIPELINE_SQL,
            stationId: station.id,
            organizationId: orgId,
          },
        },
      ],
    } as never);

    currentAuth0Id = OWNER_AUTH0;
  });

  afterEach(async () => {
    await teardownOrg(db);
    await connection.end();
  });

  it("re-executes the widget's pipeline and returns a fresh inline delivery", async () => {
    const res = await request(app)
      .post("/api/portal-sql/widget-refresh")
      .send({ messageId, blockIndex: 1 });

    expect(res.status).toBe(200);
    expect(res.body.payload).toEqual({ kind: "inline", rows: [{ n: 1 }] });
  });

  it("ignores any client-supplied SQL — only { messageId, blockIndex } is honored", async () => {
    const res = await request(app)
      .post("/api/portal-sql/widget-refresh")
      .send({ messageId, blockIndex: 1, sql: "SELECT 999 AS n" });

    expect(res.status).toBe(200);
    // The response reflects the PERSISTED pipeline (SELECT 1), not the body sql.
    expect(res.body.payload).toEqual({ kind: "inline", rows: [{ n: 1 }] });
  });

  it("a member of another org gets 404, never data", async () => {
    currentAuth0Id = OTHER_AUTH0;
    const res = await request(app)
      .post("/api/portal-sql/widget-refresh")
      .send({ messageId, blockIndex: 1 });

    expect(res.status).toBe(404);
    expect(res.body.code).toBe(ApiCode.VIZ_WIDGET_NOT_FOUND);
  });

  it("an unknown message → 404", async () => {
    const res = await request(app)
      .post("/api/portal-sql/widget-refresh")
      .send({ messageId: generateId(), blockIndex: 1 });

    expect(res.status).toBe(404);
    expect(res.body.code).toBe(ApiCode.VIZ_WIDGET_NOT_FOUND);
  });

  it("over the per-org rate limit → 429", async () => {
    // Pre-seed the current wall-clock-minute window to the cap so the next
    // call trips it (the route increments to cap+1).
    const minute = Math.floor(Date.now() / 60_000);
    await getRedisClient().set(
      `usage:rate:viz-refresh:${orgId}:${minute}`,
      String(VIZ_REFRESH_RATE_PER_MIN)
    );

    const res = await request(app)
      .post("/api/portal-sql/widget-refresh")
      .send({ messageId, blockIndex: 1 });

    expect(res.status).toBe(429);
    expect(res.body.code).toBe(ApiCode.VIZ_REFRESH_RATE_LIMITED);
  });
});
