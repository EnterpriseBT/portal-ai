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
const {
  organizations,
  stations,
  stationToolpacks,
  portals,
  portalMessages,
  tiers,
} = schema;

const now = Date.now();

/**
 * #849: hold `Date.now()` still for case 8. The ceiling reads only
 * `Date.now()` (`checkAdmission`'s default, `incrementFixedWindow`) and
 * counts turns in fixed UTC minute windows, so two real sends straddling a
 * minute boundary landed in different windows and both passed on a loaded CI
 * runner. A spy, not fake timers: every timer and `new Date()` stay real, and
 * a Jest upgrade can't widen what gets faked.
 */
const MINUTE_MS = 60_000;

describe("agent-turn ceiling gate (#498)", () => {
  let connection!: ReturnType<typeof postgres>;
  let db!: ReturnType<typeof drizzle>;
  let organizationId!: string;
  let portalId!: string;
  let stationId!: string;
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

    stationId = generateId();
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

    // #1079: a create needs a tool pack; the send route doesn't read it.
    await db.insert(stationToolpacks).values({
      id: generateId(),
      stationId,
      builtinSlug: "data_query",
      organizationToolpackId: null,
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

  // In a hook, not the test's finally: a Jest timeout abandons the test body,
  // and a still-mocked clock would follow into teardown.
  afterEach(() => {
    jest.restoreAllMocks();
  });

  afterAll(async () => {
    await teardownOrg(db as never);
    await db.delete(tiers).where(eq(tiers.slug, tierSlug));
    await connection.end({ timeout: 1 });
  });

  it("allows the first send, denies the second pre-write with 429 + Retry-After (case 8)", async () => {
    // Both sends at the instant the test starts: the same window whatever
    // the runner's speed, never earlier than the rows seeded in beforeAll,
    // and a Retry-After the test can compute exactly.
    const instant = Date.now();
    jest.spyOn(Date, "now").mockReturnValue(instant);
    const retryAfter = Math.ceil((MINUTE_MS - (instant % MINUTE_MS)) / 1000);
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
    expect(Number(second.headers["retry-after"])).toBe(retryAfter);

    // The load-bearing guarantee: the denied send wrote NOTHING.
    const afterSecond = await db
      .select()
      .from(portalMessages)
      .where(eq(portalMessages.portalId, portalId));
    expect(afterSecond).toHaveLength(1);
  });

  // #1079: a create carrying the first question is gated like a send, but a
  // refusal still creates the portal (201) and writes no message.
  it("admits the first create-with-message and refuses the second with the send route's text", async () => {
    // A later minute than case 8's, so its two turns don't count here.
    const instant = Date.now() + 5 * MINUTE_MS;
    jest.spyOn(Date, "now").mockReturnValue(instant);
    const retryAfter = Math.ceil((MINUTE_MS - (instant % MINUTE_MS)) / 1000);

    const first = await request(app)
      .post("/api/portals")
      .send({ stationId, initialMessage: "first question" });
    expect(first.status).toBe(201);
    expect(first.body.payload.initialMessage).toEqual({ status: "pending" });
    const admitted = await db
      .select()
      .from(portalMessages)
      .where(eq(portalMessages.portalId, first.body.payload.portal.id));
    expect(admitted).toHaveLength(1);

    const second = await request(app)
      .post("/api/portals")
      .send({ stationId, initialMessage: "second question, same minute" });
    expect(second.status).toBe(201);
    expect(second.headers["retry-after"]).toBeUndefined();
    expect(second.body.payload.initialMessage).toEqual({
      status: "refused",
      code: ApiCode.AGENT_TURN_LIMITED,
      message: "You're sending messages too quickly. Try again in a moment.",
      retryAfterSeconds: retryAfter,
    });
    const refused = await db
      .select()
      .from(portalMessages)
      .where(eq(portalMessages.portalId, second.body.payload.portal.id));
    expect(refused).toHaveLength(0);

    // The same words the send route answers with in the same window.
    const send = await request(app)
      .post(`/api/portals/${portalId}/messages`)
      .send({ message: "a send in the same minute" });
    expect(send.status).toBe(429);
    expect(send.body.message).toBe(second.body.payload.initialMessage.message);
  });
});
