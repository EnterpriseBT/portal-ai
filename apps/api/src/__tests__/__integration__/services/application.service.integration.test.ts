/**
 * Integration tests for ApplicationService.
 *
 * Runs against the real postgres-test database spun up by docker-compose.
 * Verifies that user, organization, and organization_users rows are created
 * atomically inside a single transaction.
 */

import { describe, it, expect, beforeEach, afterEach } from "@jest/globals";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import type { User } from "@mcp-ui/core/models";
import { UUIDv4Factory } from "@mcp-ui/core/utils";
import * as schema from "../../../db/schema/index.js";
import type { DbClient } from "../../../db/repositories/base.repository.js";
import { Repository } from "../../../db/repositories/base.repository.js";
import { ApplicationService } from "../../../services/application.service.js";

const { users, organizations, organizationUsers } = schema;
const idFactory = new UUIDv4Factory();
const generateId = () => idFactory.generate();

describe("ApplicationService Integration Tests", () => {
  let connection!: ReturnType<typeof postgres>;
  let db!: DbClient;

  beforeEach(async () => {
    if (!process.env.DATABASE_URL) {
      throw new Error("DATABASE_URL not set - setup.ts should have set this");
    }

    connection = postgres(process.env.DATABASE_URL, { max: 1 });
    db = drizzle(connection, { schema });

    // Clean tables in FK-safe order
    await db.delete(organizationUsers);
    await db.delete(organizations);
    await db.delete(users);
  });

  afterEach(async () => {
    await connection.end();
  });

  function createOwner(overrides?: Partial<User>): User {
    const now = Date.now();
    return {
      id: generateId(),
      auth0Id: `auth0|${generateId()}`,
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

  describe("setupOrganization", () => {
    it("should create a user row in the database", async () => {
      const owner = createOwner();

      const result = await ApplicationService.setupOrganization(owner);

      const usersRepo = new Repository(users);
      const found = await usersRepo.findById(result.user.id, db);

      expect(found).toBeDefined();
      expect(found?.id).toBe(owner.id);
      expect(found?.auth0Id).toBe(owner.auth0Id);
      expect(found?.email).toBe(owner.email);
      expect(found?.name).toBe(owner.name);
    });

    it("should create an organization named 'My Organization'", async () => {
      const owner = createOwner({ name: "Alice Smith" });

      const result = await ApplicationService.setupOrganization(owner);

      const orgsRepo = new Repository(organizations);
      const found = await orgsRepo.findById(result.organization.id, db);

      expect(found).toBeDefined();
      expect(found?.name).toBe("My Organization");
    });

    it("should set ownerUserId on the organization to the owner's id", async () => {
      const owner = createOwner();

      const result = await ApplicationService.setupOrganization(owner);

      const orgsRepo = new Repository(organizations);
      const found = await orgsRepo.findById(result.organization.id, db);

      expect(found).toBeDefined();
      expect(found?.ownerUserId).toBe(owner.id);
    });

    it("should set timezone to UTC on the organization", async () => {
      const owner = createOwner();

      const result = await ApplicationService.setupOrganization(owner);

      const orgsRepo = new Repository(organizations);
      const found = await orgsRepo.findById(result.organization.id, db);

      expect(found?.timezone).toBe("UTC");
    });

    it("should create an organization_users link between the user and org", async () => {
      const owner = createOwner();

      const result = await ApplicationService.setupOrganization(owner);

      const orgUsersRepo = new Repository(organizationUsers);
      const links = await orgUsersRepo.findMany(undefined, {}, db);

      expect(links).toHaveLength(1);
      expect(links[0].organizationId).toBe(result.organization.id);
      expect(links[0].userId).toBe(owner.id);
    });

    it("should set lastLogin on the organization_users link", async () => {
      const before = Date.now();
      const owner = createOwner();

      const result = await ApplicationService.setupOrganization(owner);

      const orgUsersRepo = new Repository(organizationUsers);
      const links = await orgUsersRepo.findMany(undefined, {}, db);

      expect(links).toHaveLength(1);
      expect(links[0].lastLogin).toBeGreaterThanOrEqual(before);
      expect(links[0].lastLogin).toBeLessThanOrEqual(Date.now());
      expect(result.organizationUser.lastLogin).toBe(links[0].lastLogin);
    });

    it("should return all three created entities", async () => {
      const owner = createOwner();

      const result = await ApplicationService.setupOrganization(owner);

      expect(result.user).toBeDefined();
      expect(result.user.id).toBe(owner.id);

      expect(result.organization).toBeDefined();
      expect(result.organization.ownerUserId).toBe(owner.id);

      expect(result.organizationUser).toBeDefined();
      expect(result.organizationUser.organizationId).toBe(
        result.organization.id
      );
      expect(result.organizationUser.userId).toBe(owner.id);
    });

    it("should roll back all rows if the transaction fails", async () => {
      // Create a user first so the second call with the same id causes a
      // unique constraint violation, which should roll back the whole tx.
      const owner = createOwner();
      const usersRepo = new Repository(users);
      await usersRepo.create(
        {
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
        } as never,
        db
      );

      await expect(
        ApplicationService.setupOrganization(owner)
      ).rejects.toThrow();

      // Organization and org_user should not have been created
      const orgsRepo = new Repository(organizations);
      const orgCount = await orgsRepo.count(undefined, db);
      expect(orgCount).toBe(0);

      const orgUsersRepo = new Repository(organizationUsers);
      const linkCount = await orgUsersRepo.count(undefined, db);
      expect(linkCount).toBe(0);
    });
  });

  describe("getCurrentOrganization", () => {
    async function seedUserWithOrg(
      overrides?: Partial<{ lastLogin: number | null }>
    ) {
      const owner = createOwner();
      const result = await ApplicationService.setupOrganization(owner);

      if (overrides?.lastLogin !== undefined) {
        const orgUsersRepo = new Repository(organizationUsers);
        await orgUsersRepo.update(
          result.organizationUser.id,
          { lastLogin: overrides.lastLogin } as never,
          db
        );
      }

      return result;
    }

    it("should return null when user has no organizations", async () => {
      const result =
        await ApplicationService.getCurrentOrganization(generateId());

      expect(result).toBeNull();
    });

    it("should return the organization and organizationUser for a user", async () => {
      const { user, organization } = await seedUserWithOrg();

      const result = await ApplicationService.getCurrentOrganization(user.id);

      expect(result).not.toBeNull();
      expect(result!.organization.id).toBe(organization.id);
      expect(result!.organizationUser.userId).toBe(user.id);
    });

    it("should return the organization with the most recent lastLogin", async () => {
      // Create first org with older lastLogin
      const { user } = await seedUserWithOrg({ lastLogin: 1000 });

      // Create a second org linked to the same user with a newer lastLogin
      const orgsRepo = new Repository(organizations);
      const orgUsersRepo = new Repository(organizationUsers);
      const now = Date.now();

      const secondOrg = await orgsRepo.create(
        {
          id: generateId(),
          name: "Second Org",
          timezone: "UTC",
          ownerUserId: user.id,
          created: now,
          createdBy: "SYSTEM_TEST",
          updated: null,
          updatedBy: null,
          deleted: null,
          deletedBy: null,
        } as never,
        db
      );

      await orgUsersRepo.create(
        {
          id: generateId(),
          organizationId: secondOrg.id,
          userId: user.id,
          lastLogin: 2000,
          created: now,
          createdBy: "SYSTEM_TEST",
          updated: null,
          updatedBy: null,
          deleted: null,
          deletedBy: null,
        } as never,
        db
      );

      const result = await ApplicationService.getCurrentOrganization(user.id);

      expect(result).not.toBeNull();
      expect(result!.organization.id).toBe(secondOrg.id);
    });

    it("should ignore soft-deleted organization_users links", async () => {
      const { user } = await seedUserWithOrg();

      // Soft-delete the org-user link
      const orgUsersRepo = new Repository(organizationUsers);
      const links = await orgUsersRepo.findMany(undefined, {}, db);
      await orgUsersRepo.softDelete(links[0].id, "SYSTEM_TEST", db);

      const result = await ApplicationService.getCurrentOrganization(user.id);

      expect(result).toBeNull();
    });
  });
});
