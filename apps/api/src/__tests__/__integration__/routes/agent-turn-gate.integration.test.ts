/**
 * #498 — the agent-turn ceiling gates POST /api/portals/:id/messages
 * BEFORE anything is written: a denied send returns 429 AGENT_TURN_LIMITED
 * with Retry-After and persists NO user row (the load-bearing guarantee —
 * deny-before-write, never mid-turn, never charged).
 *
 * Runs against the real DB + Redis harness. The org sits on a dedicated
 * tier row with agent_turns_per_min = 1 so the second send in a minute
 * denies deterministically.
 */

import { jest, describe, it, expect, beforeAll, afterAll } from "@jest/globals";
import request from "supertest";
import { Request, Response, NextFunction } from "express";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { eq } from "drizzle-orm";
import * as schema from "../../../db/schema/index.js";
import { ApiCode } from "../../../constants/api-codes.constants.js";
import {
  generateId,
  seedUserAndOrg,
  teardownOrg,
} from "../utils/application.util.js";

const AUTH0_ID = "auth0|agent-turn-gate-test";

jest.unstable_mockModule("../../../middleware/auth.middleware.js", () => ({
  jwtCheck: (req: Request, _res: Response, next: NextFunction) => {
    req.auth = { payload: { sub: AUTH0_ID } } as never;
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
const { organizations, stations, portals, portalMessages, tiers } = schema;

const now = Date.now();

describe("agent-turn ceiling gate (#498)", () => {
  let connection!: ReturnType<typeof postgres>;
  let db!: ReturnType<typeof drizzle>;
  let organizationId!: string;
  let portalId!: string;
  const tierSlug = `turn-gate-${generateId().slice(0, 8)}`;

  beforeAll(async () => {
    connection = postgres(process.env.DATABASE_URL!, { max: 1 });
    db = drizzle(connection, { schema });

    const seeded = await seedUserAndOrg(db as never, AUTH0_ID);
    organizationId = seeded.organizationId;

    // A dedicated tier row: 1 turn/min so the second send denies; a day
    // ceiling high enough to never trip in this test.
    await db.insert(tiers).values({
      id: generateId(),
      slug: tierSlug,
      displayName: "Turn Gate Test",
      periodKind: "monthly",
      periodAnchorDay: 1,
      overage: "hard-deny",
      freeUnitsPerPeriod: null,
      freeRatePerMin: null,
      meteredUnitsPerPeriod: null,
      meteredRatePerMin: null,
      expensiveUnitsPerPeriod: null,
      expensiveRatePerMin: null,
      agentTurnsPerMin: 1,
      agentTurnsPerDay: 1000,
      perToolCaps: null,
      stripePriceId: null,
      selectable: false,
      builtinToolpacks: [],
      customToolpacks: false,
      cta: "none",
      public: false,
      displayOrder: 0,
      description: null,
      visibleToOrganizationId: null,
      created: now,
      createdBy: "SYSTEM_TEST",
      updated: null,
      updatedBy: null,
      deleted: null,
      deletedBy: null,
    } as never);
    await db
      .update(organizations)
      .set({ tier: tierSlug } as never)
      .where(eq(organizations.id, organizationId));

    const stationId = generateId();
    await db.insert(stations).values({
      id: stationId,
      organizationId,
      name: "Turn Gate Station",
      description: null,
      created: now,
      createdBy: "SYSTEM_TEST",
      updated: null,
      updatedBy: null,
      deleted: null,
      deletedBy: null,
    } as never);

    portalId = generateId();
    await db.insert(portals).values({
      id: portalId,
      organizationId,
      stationId,
      name: "Turn Gate Portal",
      created: now,
      createdBy: "SYSTEM_TEST",
      updated: null,
      updatedBy: null,
      deleted: null,
      deletedBy: null,
    } as never);
  });

  afterAll(async () => {
    await teardownOrg(db as never);
    await db.delete(tiers).where(eq(tiers.slug, tierSlug));
    await connection.end({ timeout: 1 });
  });

  it("allows the first send, denies the second pre-write with 429 + Retry-After (case 8)", async () => {
    const first = await request(app)
      .post(`/api/portals/${portalId}/messages`)
      .send({ message: "first turn" });
    expect(first.status).toBe(200);

    const afterFirst = await db
      .select()
      .from(portalMessages)
      .where(eq(portalMessages.portalId, portalId));
    expect(afterFirst).toHaveLength(1);

    const second = await request(app)
      .post(`/api/portals/${portalId}/messages`)
      .send({ message: "second turn, same minute" });
    expect(second.status).toBe(429);
    expect(second.body.code).toBe(ApiCode.AGENT_TURN_LIMITED);
    expect(Number(second.headers["retry-after"])).toBeGreaterThan(0);
    expect(Number(second.headers["retry-after"])).toBeLessThanOrEqual(60);

    // The load-bearing guarantee: the denied send wrote NOTHING.
    const afterSecond = await db
      .select()
      .from(portalMessages)
      .where(eq(portalMessages.portalId, portalId));
    expect(afterSecond).toHaveLength(1);
  });
});
