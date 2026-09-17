/**
 * End-to-end read-only degradation (#568, case 20) — requireOrgWritable on the
 * real protectedRouter + DB. A seeded user/org/membership drives
 * getCurrentOrganization; the org's `entitlementThrough` is flipped directly to
 * assert the gate: a lapsed term 403s writes, reads pass, and renewal restores
 * writes.
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
import { eq } from "drizzle-orm";

import * as schema from "../../../db/schema/index.js";
import { ApiCode } from "../../../constants/api-codes.constants.js";
import {
  teardownOrg,
  createUser,
  createOrganization,
  createOrganizationUser,
} from "../utils/application.util.js";

const AUTH0_SUB = `auth0|writable-e2e-${Date.now()}`;

jest.unstable_mockModule("../../../middleware/auth.middleware.js", () => ({
  jwtCheck: (req: Request, _res: Response, next: NextFunction) => {
    req.auth = { payload: { sub: AUTH0_SUB } } as never;
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

const DAY = 86_400_000;

describe("read-only degradation on protectedRouter (#568, case 20)", () => {
  let connection!: ReturnType<typeof postgres>;
  let db!: ReturnType<typeof drizzle>;
  let orgId: string;

  beforeEach(async () => {
    connection = postgres(process.env.DATABASE_URL as string, { max: 2 });
    db = drizzle(connection, { schema });
    await teardownOrg(db);

    const user = createUser(AUTH0_SUB);
    await db.insert(schema.users).values(user as never);
    const org = createOrganization(user.id);
    await db.insert(schema.organizations).values(org as never);
    orgId = org.id;
    await db
      .insert(schema.organizationUsers)
      .values(createOrganizationUser(org.id, user.id) as never);
  });

  afterEach(async () => {
    await teardownOrg(db);
    await connection.end();
  });

  async function setTerm(entitlementThrough: number | null) {
    await db
      .update(schema.organizations)
      .set({ entitlementThrough })
      .where(eq(schema.organizations.id, orgId));
  }

  it("a writable org (future term) is not gated on a POST", async () => {
    await setTerm(Date.now() + DAY);
    const res = await request(app).post("/api/stations").send({});
    expect(res.body.code).not.toBe(ApiCode.ORG_ENTITLEMENT_EXPIRED);
  });

  it("a lapsed org 403s a POST with ORG_ENTITLEMENT_EXPIRED", async () => {
    await setTerm(Date.now() - DAY);
    const res = await request(app).post("/api/stations").send({});
    expect(res.status).toBe(403);
    expect(res.body.code).toBe(ApiCode.ORG_ENTITLEMENT_EXPIRED);
  });

  it("a lapsed org still allows reads (GET is never gated)", async () => {
    await setTerm(Date.now() - DAY);
    const res = await request(app).get("/api/stations");
    expect(res.status).not.toBe(403);
    expect(res.body.code).not.toBe(ApiCode.ORG_ENTITLEMENT_EXPIRED);
  });

  it("renewal (future term) restores writes", async () => {
    await setTerm(Date.now() - DAY);
    const denied = await request(app).post("/api/stations").send({});
    expect(denied.status).toBe(403);

    await setTerm(Date.now() + DAY);
    const restored = await request(app).post("/api/stations").send({});
    expect(restored.body.code).not.toBe(ApiCode.ORG_ENTITLEMENT_EXPIRED);
  });
});
