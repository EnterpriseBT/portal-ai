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
import type { User } from "@mcp-ui/core/models";
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
});
