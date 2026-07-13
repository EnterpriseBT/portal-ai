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
import type { User } from "@portalai/core/models";
import * as schema from "../../../db/schema/index.js";
import type { DbClient } from "../../../db/repositories/base.repository.js";
import { ApiCode } from "../../../constants/api-codes.constants.js";
import { ApplicationService } from "../../../services/application.service.js";
import { generateId, teardownOrg } from "../utils/application.util.js";

const AUTH0_ID = "auth0|org-test-user";

// Mock the auth middleware to populate req.auth with our test sub
jest.unstable_mockModule("../../../middleware/auth.middleware.js", () => ({
  jwtCheck: (req: Request, _res: Response, next: NextFunction) => {
    req.auth = { payload: { sub: AUTH0_ID } } as never;
    next();
  },
}));

// Mock Auth0Service (required by profile router which shares the protected router)
jest.unstable_mockModule("../../../services/auth0.service.js", () => ({
  Auth0Service: {
    hasAccessToken: jest.fn(),
    getAccessToken: jest.fn(),
    getAuth0UserProfile: jest.fn(),
  },
}));

const { app } = await import("../../../app.js");

const { users, organizations, organizationUsers } = schema;

describe("Organization Router", () => {
  let connection!: ReturnType<typeof postgres>;
  let db!: DbClient;

  beforeEach(async () => {
    if (!process.env.DATABASE_URL) {
      throw new Error("DATABASE_URL not set - setup.ts should have set this");
    }

    connection = postgres(process.env.DATABASE_URL, { max: 1 });
    db = drizzle(connection, { schema });

    await teardownOrg(db as ReturnType<typeof drizzle>);
  });

  afterEach(async () => {
    await connection.end();
  });

  function createOwner(overrides?: Partial<User>): User {
    const now = Date.now();
    return {
      id: generateId(),
      auth0Id: AUTH0_ID,
      email: `owner-${generateId()}@example.com`,
      name: "Jane Doe",
      lastLogin: now,
      picture: "https://example.com/avatar.png",
      created: now,
      createdBy: "SYSTEM_TEST",
      updated: null,
      updatedBy: null,
      deleted: null,
      deletedBy: null,
      ...overrides,
    };
  }

  describe("GET /api/organization/current", () => {
    it("should return 404 when user does not exist", async () => {
      const res = await request(app)
        .get("/api/organization/current")
        .set("Authorization", "Bearer test-token");

      expect(res.status).toBe(404);
      expect(res.body.success).toBe(false);
      expect(res.body.code).toBe(ApiCode.ORGANIZATION_USER_NOT_FOUND);
    });

    it("should return 404 when user exists but has no organization", async () => {
      // Create user directly without an organization
      const owner = createOwner();
      await (db as ReturnType<typeof drizzle>).insert(users).values({
        id: owner.id,
        auth0Id: owner.auth0Id,
        email: owner.email,
        name: owner.name,
        picture: owner.picture,
        created: owner.created,
        createdBy: owner.createdBy,
        updated: null,
        updatedBy: null,
        deleted: null,
        deletedBy: null,
      } as never);

      const res = await request(app)
        .get("/api/organization/current")
        .set("Authorization", "Bearer test-token");

      expect(res.status).toBe(404);
      expect(res.body.success).toBe(false);
      expect(res.body.code).toBe(ApiCode.ORGANIZATION_NOT_FOUND);
    });

    it("should return 200 with the current organization", async () => {
      const owner = createOwner();
      const result = await ApplicationService.setupOrganization(owner);

      const res = await request(app)
        .get("/api/organization/current")
        .set("Authorization", "Bearer test-token");

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.payload.organization.id).toBe(result.organization.id);
      expect(res.body.payload.organization.name).toBe("My Organization");
      // #172 slice 2: `tier` flows onto OrganizationGetResponse with no mapper.
      expect(res.body.payload.organization.tier).toBe("standard");
    });

    it("should return the organization with the most recent login", async () => {
      // Setup first org via ApplicationService
      const owner = createOwner();
      await ApplicationService.setupOrganization(owner);

      // Retrieve the user to get internal ID
      const { DbService } = await import("../../../services/db.service.js");
      const user = await DbService.repository.users.findByAuth0Id(AUTH0_ID);

      // Create a second org with a newer lastLogin
      const now = Date.now();
      const secondOrgId = generateId();
      await (db as ReturnType<typeof drizzle>).insert(organizations).values({
        id: secondOrgId,
        name: "Second Org",
        timezone: "UTC",
        ownerUserId: user!.id,
        created: now,
        createdBy: "SYSTEM_TEST",
        updated: null,
        updatedBy: null,
        deleted: null,
        deletedBy: null,
      } as never);

      await (db as ReturnType<typeof drizzle>)
        .insert(organizationUsers)
        .values({
          id: generateId(),
          organizationId: secondOrgId,
          userId: user!.id,
          lastLogin: now + 100000,
          created: now,
          createdBy: "SYSTEM_TEST",
          updated: null,
          updatedBy: null,
          deleted: null,
          deletedBy: null,
        } as never);

      const res = await request(app)
        .get("/api/organization/current")
        .set("Authorization", "Bearer test-token");

      expect(res.status).toBe(200);
      expect(res.body.payload.organization.id).toBe(secondOrgId);
      expect(res.body.payload.organization.name).toBe("Second Org");
    });
  });

  describe("GET /api/organization/usage (#172 slice 3)", () => {
    it("returns the tier policy and a zeroed usage balance for a standard org", async () => {
      const owner = createOwner();
      await ApplicationService.setupOrganization(owner);

      const res = await request(app)
        .get("/api/organization/usage")
        .set("Authorization", "Bearer test-token");

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.payload.tier.tier).toBe("standard");
      // no usage rows yet → used 0, available = full allocation
      expect(res.body.payload.usage.byClass.metered.used).toBe(0);
      expect(res.body.payload.usage.byClass.metered.available).toBe(1000);
      // free is unlimited on standard
      expect(res.body.payload.usage.byClass.free.available).toBeNull();
    });

    it("reflects an incremented usage balance", async () => {
      const owner = createOwner();
      const result = await ApplicationService.setupOrganization(owner);

      const { TierService } = await import("../../../services/tier.service.js");
      const { UsageService } =
        await import("../../../services/usage.service.js");

      // Charge 30 metered units in the same period the endpoint will read.
      const periodId = TierService.periodIdFor(
        { kind: "monthly", anchorDay: 1 },
        new Date()
      );
      await UsageService.increment(
        result.organization.id,
        "metered",
        30,
        periodId,
        { userId: "SYSTEM_TEST" }
      );

      const res = await request(app)
        .get("/api/organization/usage")
        .set("Authorization", "Bearer test-token");

      expect(res.status).toBe(200);
      expect(res.body.payload.usage.byClass.metered.used).toBe(30);
      expect(res.body.payload.usage.byClass.metered.available).toBe(970);
    });
  });

  // Attach the AUTH0_ID user to a second org (a live membership) so the
  // switcher endpoints have something to list/switch between.
  async function addSecondOrg(
    userId: string,
    lastLogin: number | null
  ): Promise<string> {
    const d = db as ReturnType<typeof drizzle>;
    const orgId = generateId();
    await d.insert(organizations).values({
      id: orgId,
      name: "Second Org",
      timezone: "UTC",
      ownerUserId: userId,
      tier: "standard",
      defaultStationId: null,
      created: Date.now(),
      createdBy: "SYSTEM_TEST",
      updated: null,
      updatedBy: null,
      deleted: null,
      deletedBy: null,
    } as never);
    await d.insert(organizationUsers).values({
      id: generateId(),
      organizationId: orgId,
      userId,
      lastLogin,
      created: Date.now(),
      createdBy: "SYSTEM_TEST",
      updated: null,
      updatedBy: null,
      deleted: null,
      deletedBy: null,
    } as never);
    return orgId;
  }

  describe("GET /api/organization/memberships", () => {
    it("returns 404 when the user does not exist", async () => {
      const res = await request(app)
        .get("/api/organization/memberships")
        .set("Authorization", "Bearer test-token");
      expect(res.status).toBe(404);
      expect(res.body.code).toBe(ApiCode.ORGANIZATION_USER_NOT_FOUND);
    });

    it("lists the user's live memberships, flagging the current one", async () => {
      const owner = createOwner();
      const result = await ApplicationService.setupOrganization(owner);
      // Second org, never entered (lastLogin=0) → not current.
      const secondOrgId = await addSecondOrg(result.user.id, 0);

      const res = await request(app)
        .get("/api/organization/memberships")
        .set("Authorization", "Bearer test-token");

      expect(res.status).toBe(200);
      const memberships = res.body.payload.memberships as Array<{
        organization: { id: string };
        isCurrent: boolean;
      }>;
      expect(memberships).toHaveLength(2);
      const byId = Object.fromEntries(
        memberships.map((m) => [m.organization.id, m.isCurrent])
      );
      expect(byId[result.organization.id]).toBe(true); // signup org (lastLogin=now)
      expect(byId[secondOrgId]).toBe(false);
    });
  });

  describe("POST /api/organization/switch", () => {
    it("flips the current org to the target (GET /current reflects it)", async () => {
      const owner = createOwner();
      const result = await ApplicationService.setupOrganization(owner);
      const secondOrgId = await addSecondOrg(result.user.id, 0);

      const switchRes = await request(app)
        .post("/api/organization/switch")
        .set("Authorization", "Bearer test-token")
        .send({ organizationId: secondOrgId });
      expect(switchRes.status).toBe(200);
      expect(switchRes.body.payload.organization.id).toBe(secondOrgId);

      const currentRes = await request(app)
        .get("/api/organization/current")
        .set("Authorization", "Bearer test-token");
      expect(currentRes.body.payload.organization.id).toBe(secondOrgId);
    });

    it("returns 403 MEMBERSHIP_NOT_FOUND for an org the user does not belong to", async () => {
      const owner = createOwner();
      await ApplicationService.setupOrganization(owner);
      const d = db as ReturnType<typeof drizzle>;
      // An org the user has no membership in.
      const strangerUserId = generateId();
      await d.insert(users).values({
        id: strangerUserId,
        auth0Id: `auth0|stranger-${strangerUserId}`,
        email: `stranger-${strangerUserId}@example.com`,
        name: "Stranger",
        picture: null,
        lastLogin: null,
        created: Date.now(),
        createdBy: "SYSTEM_TEST",
        updated: null,
        updatedBy: null,
        deleted: null,
        deletedBy: null,
      } as never);
      const foreignOrgId = generateId();
      await d.insert(organizations).values({
        id: foreignOrgId,
        name: "Foreign Org",
        timezone: "UTC",
        ownerUserId: strangerUserId,
        tier: "standard",
        defaultStationId: null,
        created: Date.now(),
        createdBy: "SYSTEM_TEST",
        updated: null,
        updatedBy: null,
        deleted: null,
        deletedBy: null,
      } as never);

      const res = await request(app)
        .post("/api/organization/switch")
        .set("Authorization", "Bearer test-token")
        .send({ organizationId: foreignOrgId });
      expect(res.status).toBe(403);
      expect(res.body.code).toBe(ApiCode.MEMBERSHIP_NOT_FOUND);
    });

    it("returns 404 when the user does not exist", async () => {
      const res = await request(app)
        .post("/api/organization/switch")
        .set("Authorization", "Bearer test-token")
        .send({ organizationId: generateId() });
      expect(res.status).toBe(404);
      expect(res.body.code).toBe(ApiCode.ORGANIZATION_USER_NOT_FOUND);
    });
  });
});
