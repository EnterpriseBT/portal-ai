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
import type { User } from "@portalai/core/models";
import * as schema from "../../../db/schema/index.js";
import type { DbClient } from "../../../db/repositories/base.repository.js";
import { Repository } from "../../../db/repositories/base.repository.js";
import { StationToolpacksRepository } from "../../../db/repositories/station-toolpacks.repository.js";
import { ApplicationService } from "../../../services/application.service.js";
import { ApiCode } from "../../../constants/api-codes.constants.js";
import { SeedService } from "../../../services/seed.service.js";
import { generateId, teardownOrg } from "../utils/application.util.js";

const {
  users,
  organizations,
  organizationUsers,
  connectorInstances,
  connectorDefinitions,
  stations,
  stationInstances,
} = schema;

describe("ApplicationService Integration Tests", () => {
  let connection!: ReturnType<typeof postgres>;
  let db!: DbClient;

  beforeEach(async () => {
    if (!process.env.DATABASE_URL) {
      throw new Error("DATABASE_URL not set - setup.ts should have set this");
    }

    connection = postgres(process.env.DATABASE_URL, { max: 1 });
    db = drizzle(connection, { schema });

    await teardownOrg(db as ReturnType<typeof drizzle>);

    // Seed connector definitions so sandbox auto-provisioning can execute
    const seedService = new SeedService();
    await seedService.seedConnectorDefinitions(db);
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

    it("should create a sandbox connector instance for the new organization", async () => {
      const owner = createOwner();

      const result = await ApplicationService.setupOrganization(owner);

      const instancesRepo = new Repository(connectorInstances);
      const instances = await instancesRepo.findMany(undefined, {}, db);
      const sandbox = instances.find(
        (i) => i.organizationId === result.organization.id
      );

      expect(sandbox).toBeDefined();
      expect(sandbox?.name).toBe("Sandbox");
      expect(sandbox?.status).toBe("active");
      expect(sandbox?.enabledCapabilityFlags).toEqual({
        read: true,
        write: true,
        sync: false,
        push: false,
      });

      // Verify connectorDefinitionId matches the sandbox definition
      const defsRepo = new Repository(connectorDefinitions);
      const defs = await defsRepo.findMany(undefined, {}, db);
      const sandboxDef = defs.find((d) => d.slug === "sandbox");
      expect(sandbox?.connectorDefinitionId).toBe(sandboxDef?.id);
    });

    it("should create a default station with data_query tool pack", async () => {
      const owner = createOwner();

      const result = await ApplicationService.setupOrganization(owner);

      const stationsRepo = new Repository(stations);
      const allStations = await stationsRepo.findMany(undefined, {}, db);
      const station = allStations.find(
        (s) => s.organizationId === result.organization.id
      );

      expect(station).toBeDefined();
      expect(station?.name).toBe("My Station");

      const stationToolpacksRepo = new StationToolpacksRepository();
      const enabled = await stationToolpacksRepo.findByStationId(
        station!.id,
        db
      );
      expect(enabled.map((r) => r.builtinSlug)).toEqual(["data_query"]);
    });

    it("should link the sandbox connector instance to the default station", async () => {
      const owner = createOwner();

      const result = await ApplicationService.setupOrganization(owner);

      const instancesRepo = new Repository(connectorInstances);
      const instances = await instancesRepo.findMany(undefined, {}, db);
      const instance = instances.find(
        (i) => i.organizationId === result.organization.id
      );

      const stationsRepo = new Repository(stations);
      const allStations = await stationsRepo.findMany(undefined, {}, db);
      const station = allStations.find(
        (s) => s.organizationId === result.organization.id
      );

      const stationInstancesRepo = new Repository(stationInstances);
      const links = await stationInstancesRepo.findMany(undefined, {}, db);
      const link = links.find(
        (l) =>
          l.stationId === station?.id && l.connectorInstanceId === instance?.id
      );

      expect(link).toBeDefined();
    });

    it("should set defaultStationId on the organization", async () => {
      const owner = createOwner();

      const result = await ApplicationService.setupOrganization(owner);

      const orgsRepo = new Repository(organizations);
      const found = await orgsRepo.findById(result.organization.id, db);

      const stationsRepo = new Repository(stations);
      const allStations = await stationsRepo.findMany(undefined, {}, db);
      const station = allStations.find(
        (s) => s.organizationId === result.organization.id
      );

      expect(found?.defaultStationId).toBe(station?.id);
      expect(result.organization.defaultStationId).toBe(station?.id);
    });

    it("should still succeed if sandbox definition does not exist", async () => {
      // Remove all connector definitions so sandbox def is missing
      await db.delete(connectorDefinitions);

      const owner = createOwner();
      const result = await ApplicationService.setupOrganization(owner);

      expect(result.user).toBeDefined();
      expect(result.organization).toBeDefined();
      expect(result.organizationUser).toBeDefined();

      // No connector instances or stations should have been created
      const instancesRepo = new Repository(connectorInstances);
      const instanceCount = await instancesRepo.count(undefined, db);
      expect(instanceCount).toBe(0);

      const stationsRepo = new Repository(stations);
      const stationCount = await stationsRepo.count(undefined, db);
      expect(stationCount).toBe(0);
    });

    it("should roll back sandbox provisioning if station creation fails", async () => {
      // We verify transaction atomicity by attempting to set up with a
      // duplicate user id (which fails), then checking no provisioning
      // artifacts remain.
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

      // Neither connector instances nor stations should exist
      const instancesRepo = new Repository(connectorInstances);
      const instanceCount = await instancesRepo.count(undefined, db);
      expect(instanceCount).toBe(0);

      const stationsRepo = new Repository(stations);
      const stationCount = await stationsRepo.count(undefined, db);
      expect(stationCount).toBe(0);
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

    it("should not let a NULL-lastLogin membership hijack the current org (NULLS LAST)", async () => {
      // The user's real org, stamped at signup.
      const { user, organization } = await seedUserWithOrg({ lastLogin: 1000 });

      // A second membership with NULL lastLogin (e.g. an operator-added org
      // from an older code path). Under `ORDER BY last_login DESC` Postgres
      // sorts NULLS FIRST, so this would wrongly win without NULLS LAST.
      const orgsRepo = new Repository(organizations);
      const orgUsersRepo = new Repository(organizationUsers);
      const now = Date.now();

      const otherOrg = await orgsRepo.create(
        {
          id: generateId(),
          name: "Null-Login Org",
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
          organizationId: otherOrg.id,
          userId: user.id,
          lastLogin: null,
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
      expect(result!.organization.id).toBe(organization.id); // the real org, not the null one
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

  // Seed the AUTH0 user with their signup org, overriding the membership's
  // lastLogin (mirrors the getCurrentOrganization block's seedUserWithOrg,
  // which is scoped to that describe).
  async function seedOwnerWithLogin(lastLogin: number) {
    const result = await ApplicationService.setupOrganization(createOwner());
    await new Repository(organizationUsers).update(
      result.organizationUser.id,
      { lastLogin } as never,
      db
    );
    return result;
  }

  describe("listUserMemberships", () => {
    async function addOrg(
      userId: string,
      name: string,
      lastLogin: number | null,
      opts: { orgDeleted?: boolean; membershipDeleted?: boolean } = {}
    ): Promise<string> {
      const orgsRepo = new Repository(organizations);
      const orgUsersRepo = new Repository(organizationUsers);
      const now = Date.now();
      const orgId = generateId();
      await orgsRepo.create(
        {
          id: orgId,
          name,
          timezone: "UTC",
          ownerUserId: userId,
          tier: "standard",
          created: now,
          createdBy: "SYSTEM_TEST",
          updated: null,
          updatedBy: null,
          deleted: opts.orgDeleted ? now : null,
          deletedBy: opts.orgDeleted ? "SYSTEM_TEST" : null,
        } as never,
        db
      );
      await orgUsersRepo.create(
        {
          id: generateId(),
          organizationId: orgId,
          userId,
          lastLogin,
          created: now,
          createdBy: "SYSTEM_TEST",
          updated: null,
          updatedBy: null,
          deleted: opts.membershipDeleted ? now : null,
          deletedBy: opts.membershipDeleted ? "SYSTEM_TEST" : null,
        } as never,
        db
      );
      return orgId;
    }

    it("returns live memberships flagging the current (max last_login) org, excluding soft-deleted rows", async () => {
      const { user, organization } = await seedOwnerWithLogin(5000);
      const second = await addOrg(user.id, "Second", 0);
      // Low lastLogin on the excluded rows so they can't affect the current pick.
      await addOrg(user.id, "Deleted Membership", 1, {
        membershipDeleted: true,
      });
      await addOrg(user.id, "Deleted Org", 1, { orgDeleted: true });

      const memberships = await ApplicationService.listUserMemberships(user.id);

      const ids = memberships.map((m) => m.organization.id).sort();
      expect(ids).toEqual([organization.id, second].sort()); // only the 2 live ones
      const current = memberships.find((m) => m.isCurrent);
      expect(current!.organization.id).toBe(organization.id); // lastLogin 5000 > 0
      expect(memberships.filter((m) => m.isCurrent)).toHaveLength(1);
    });
  });

  describe("switchOrganization", () => {
    it("bumps last_login so the target becomes current, and returns it", async () => {
      const { user, organization } = await seedOwnerWithLogin(5000);
      const orgsRepo = new Repository(organizations);
      const orgUsersRepo = new Repository(organizationUsers);
      const now = Date.now();
      const target = await orgsRepo.create(
        {
          id: generateId(),
          name: "Target",
          timezone: "UTC",
          ownerUserId: user.id,
          tier: "standard",
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
          organizationId: target.id,
          userId: user.id,
          lastLogin: 0,
          created: now,
          createdBy: "SYSTEM_TEST",
          updated: null,
          updatedBy: null,
          deleted: null,
          deletedBy: null,
        } as never,
        db
      );

      const result = await ApplicationService.switchOrganization(
        user.id,
        target.id
      );
      expect(result.organization.id).toBe(target.id);

      const current = await ApplicationService.getCurrentOrganization(user.id);
      expect(current!.organization.id).toBe(target.id); // beat the old lastLogin 5000
      expect(organization.id).not.toBe(target.id);
    });

    it("throws MEMBERSHIP_NOT_FOUND when the user has no live membership in the target", async () => {
      const { user } = await seedOwnerWithLogin(5000);
      const orgsRepo = new Repository(organizations);
      const usersRepo = new Repository(users);
      const now = Date.now();
      // A real stranger user to own the foreign org (owner_user_id FK).
      const stranger = await usersRepo.create(
        {
          id: generateId(),
          auth0Id: `auth0|stranger-${generateId()}`,
          email: `stranger-${generateId()}@example.com`,
          name: "Stranger",
          picture: null,
          lastLogin: null,
          created: now,
          createdBy: "SYSTEM_TEST",
          updated: null,
          updatedBy: null,
          deleted: null,
          deletedBy: null,
        } as never,
        db
      );
      const foreign = await orgsRepo.create(
        {
          id: generateId(),
          name: "Foreign",
          timezone: "UTC",
          ownerUserId: stranger.id,
          tier: "standard",
          created: now,
          createdBy: "SYSTEM_TEST",
          updated: null,
          updatedBy: null,
          deleted: null,
          deletedBy: null,
        } as never,
        db
      );

      await expect(
        ApplicationService.switchOrganization(user.id, foreign.id)
      ).rejects.toMatchObject({ code: ApiCode.MEMBERSHIP_NOT_FOUND });
    });
  });
});
