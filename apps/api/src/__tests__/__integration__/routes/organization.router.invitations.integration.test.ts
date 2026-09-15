/**
 * Route wiring for the seats endpoints (#584, slice 2). SeatService logic is
 * covered by its own integration suite; this asserts the HTTP surface —
 * status, payload shape, and role authz — through real requests.
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
import { eq, like } from "drizzle-orm";
import postgres from "postgres";

import * as schema from "../../../db/schema/index.js";
import type { DbClient } from "../../../db/repositories/base.repository.js";
import { ApiCode } from "../../../constants/api-codes.constants.js";
import {
  generateId,
  createUser,
  createOrganization,
  createOrganizationUser,
  teardownOrg,
} from "../utils/application.util.js";

const AUTH0_ID = "auth0|seats-caller";

jest.unstable_mockModule("../../../middleware/auth.middleware.js", () => ({
  jwtCheck: (req: Request, _res: Response, next: NextFunction) => {
    if (req.headers.authorization) {
      req.auth = { payload: { sub: AUTH0_ID } } as never;
    }
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

describe("Organization seats routes (#584)", () => {
  let connection!: ReturnType<typeof postgres>;
  let db!: DbClient;
  const asDrizzle = () => db as ReturnType<typeof drizzle>;
  const auth = (r: request.Test) => r.set("Authorization", "Bearer test");

  async function seed(role: "owner" | "admin" | "member") {
    const u = createUser(AUTH0_ID, { email: "caller@x.com" });
    await asDrizzle()
      .insert(schema.users)
      .values(u as never);
    const org = createOrganization(u.id);
    await asDrizzle()
      .insert(schema.organizations)
      .values(org as never);
    await asDrizzle()
      .insert(schema.organizationUsers)
      .values(createOrganizationUser(org.id, u.id, { role }) as never);
    // Point the org at an unlimited test tier so seat resolution succeeds.
    const slug = `seat-route-test-${generateId()}`;
    await asDrizzle()
      .insert(schema.tiers)
      .values({
        id: generateId(),
        created: Date.now(),
        createdBy: "SYSTEM_TEST",
        slug,
        displayName: "Route Test Tier",
        maxSeats: null,
      } as never);
    await asDrizzle()
      .update(schema.organizations)
      .set({ tier: slug })
      .where(eq(schema.organizations.id, org.id));
  }

  beforeEach(async () => {
    if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL not set");
    connection = postgres(process.env.DATABASE_URL, { max: 2 });
    db = drizzle(connection, { schema });
    await teardownOrg(asDrizzle());
  });

  afterEach(async () => {
    await teardownOrg(asDrizzle());
    await asDrizzle()
      .delete(schema.tiers)
      .where(like(schema.tiers.slug, "seat-route-test-%"));
    await connection.end();
  });

  it("owner: POST /invitations → 200 with inviteUrl, no tokenHash", async () => {
    await seed("owner");
    const res = await auth(
      request(app)
        .post("/api/organization/invitations")
        .send({ email: "new@x.com", role: "member" })
    );
    expect(res.status).toBe(200);
    expect(res.body.payload.email).toBe("new@x.com");
    expect(res.body.payload.inviteUrl).toContain("token=");
    expect(res.body.payload.tokenHash).toBeUndefined();
  });

  it("owner: GET /invitations and GET /members return the expected shapes", async () => {
    await seed("owner");
    await auth(
      request(app)
        .post("/api/organization/invitations")
        .send({ email: "p@x.com", role: "member" })
    );

    const list = await auth(request(app).get("/api/organization/invitations"));
    expect(list.status).toBe(200);
    expect(list.body.payload.invitations).toHaveLength(1);

    const members = await auth(request(app).get("/api/organization/members"));
    expect(members.status).toBe(200);
    expect(members.body.payload.members).toHaveLength(1);
    expect(members.body.payload.members[0].role).toBe("owner");
  });

  it("owner: revoke a pending invitation → 200 revoked", async () => {
    await seed("owner");
    const created = await auth(
      request(app)
        .post("/api/organization/invitations")
        .send({ email: "r@x.com", role: "member" })
    );
    const id = created.body.payload.id;
    const revoked = await auth(
      request(app).post(`/api/organization/invitations/${id}/revoke`)
    );
    expect(revoked.status).toBe(200);
    expect(revoked.body.payload.status).toBe("revoked");
  });

  it("member: POST /invitations → 403 INSUFFICIENT_ROLE", async () => {
    await seed("member");
    const res = await auth(
      request(app)
        .post("/api/organization/invitations")
        .send({ email: "x@x.com", role: "member" })
    );
    expect(res.status).toBe(403);
    expect(res.body.code).toBe(ApiCode.INSUFFICIENT_ROLE);
  });

  it("rejects an invalid invite body → 400", async () => {
    await seed("owner");
    const res = await auth(
      request(app)
        .post("/api/organization/invitations")
        .send({ email: "not-an-email", role: "owner" })
    );
    expect(res.status).toBe(400);
  });
});
