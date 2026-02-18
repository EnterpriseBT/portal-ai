/**
 * Integration tests for ApplicationService.setupOrganization().
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
});
