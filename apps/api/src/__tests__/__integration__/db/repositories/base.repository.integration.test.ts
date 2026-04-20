/**
 * Integration tests for the base Repository class.
 *
 * These tests run against a real PostgreSQL database spun up by testcontainers.
 * They verify CRUD operations, soft-delete semantics, transactions, and bulk operations.
 */

import { describe, it, expect, beforeEach, afterEach } from "@jest/globals";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { eq } from "drizzle-orm";
import {
  Repository,
  type DbClient,
} from "../../../../db/repositories/base.repository.js";
import * as schema from "../../../../db/schema/index.js";
import type {
  UserInsert,
  UserSelect,
  JobInsert,
  JobSelect,
} from "../../../../db/schema/zod.js";
import { generateId, teardownOrg } from "../../utils/application.util.js";

const { users, jobs } = schema;

describe("Repository Integration Tests", () => {
  let connection!: ReturnType<typeof postgres>;
  let db!: DbClient;
  let usersRepo: Repository<typeof users, UserSelect, UserInsert>;

  beforeEach(async () => {
    // Create a fresh database connection for each test
    if (!process.env.DATABASE_URL) {
      throw new Error("DATABASE_URL not set - setup.ts should have set this");
    }

    connection = postgres(process.env.DATABASE_URL, { max: 1 });
    db = drizzle(connection, { schema });
    usersRepo = new Repository(users);

    await teardownOrg(db as ReturnType<typeof drizzle>);
  });

  afterEach(async () => {
    // Close connection after each test
    await connection.end();
  });

  // ── Helper functions ──────────────────────────────────────────────

  function createTestUser(overrides?: Partial<UserInsert>): UserInsert {
    const now = Date.now();
    return {
      id: generateId(),
      auth0Id: `auth0|${generateId()}`,
      email: `test-${generateId()}@example.com`,
      name: "Test User",
      picture: null,
      created: now,
      createdBy: "test-system",
      updated: null,
      updatedBy: null,
      deleted: null,
      deletedBy: null,
      ...overrides,
    } as UserInsert;
  }

  // ── READ TESTS ────────────────────────────────────────────────────

  describe("findById", () => {
    it("should return a user by ID", async () => {
      const userData = createTestUser();
      await usersRepo.create(userData, db);

      const result = await usersRepo.findById(userData.id, db);

      expect(result).toBeDefined();
      expect(result?.id).toBe(userData.id);
      expect(result?.email).toBe(userData.email);
    });

    it("should return undefined for non-existent ID", async () => {
      const result = await usersRepo.findById("non-existent-id", db);

      expect(result).toBeUndefined();
    });

    it("should not return soft-deleted users", async () => {
      const userData = createTestUser();
      const created = await usersRepo.create(userData, db);
      await usersRepo.softDelete(created.id, "test-system", db);

      const result = await usersRepo.findById(created.id, db);

      expect(result).toBeUndefined();
    });
  });

  describe("findMany", () => {
    it("should return all non-deleted users when no filter is provided", async () => {
      const user1 = createTestUser();
      const user2 = createTestUser();
      await usersRepo.create(user1, db);
      await usersRepo.create(user2, db);

      const results = await usersRepo.findMany(undefined, {}, db);

      expect(results).toHaveLength(2);
    });

    it("should support filtering with where clause", async () => {
      const email = `unique-${generateId()}@example.com`;
      const user1 = createTestUser({ email });
      const user2 = createTestUser();
      await usersRepo.create(user1, db);
      await usersRepo.create(user2, db);

      const results = await usersRepo.findMany(eq(users.email, email), {}, db);

      expect(results).toHaveLength(1);
      expect(results[0].email).toBe(email);
    });

    it("should support pagination with limit and offset", async () => {
      // Create 5 users
      for (let i = 0; i < 5; i++) {
        await usersRepo.create(createTestUser(), db);
      }

      const page1 = await usersRepo.findMany(
        undefined,
        { limit: 2, offset: 0 },
        db
      );
      const page2 = await usersRepo.findMany(
        undefined,
        { limit: 2, offset: 2 },
        db
      );

      expect(page1).toHaveLength(2);
      expect(page2).toHaveLength(2);
      expect(page1[0].id).not.toBe(page2[0].id);
    });

    it("should exclude soft-deleted users by default", async () => {
      const user1 = createTestUser();
      const user2 = createTestUser();
      const created1 = await usersRepo.create(user1, db);
      await usersRepo.create(user2, db);
      await usersRepo.softDelete(created1.id, "test-system", db);

      const results = await usersRepo.findMany(undefined, {}, db);

      expect(results).toHaveLength(1);
      expect(results[0].id).toBe(user2.id);
    });

    it("should include soft-deleted users when includeDeleted is true", async () => {
      const user1 = createTestUser();
      const user2 = createTestUser();
      const created1 = await usersRepo.create(user1, db);
      await usersRepo.create(user2, db);
      await usersRepo.softDelete(created1.id, "test-system", db);

      const results = await usersRepo.findMany(
        undefined,
        { includeDeleted: true },
        db
      );

      expect(results).toHaveLength(2);
    });

    it("should filter by organizationId when provided in ListOptions", async () => {
      const jobsRepo = new Repository<typeof jobs, JobSelect, JobInsert>(jobs);
      const orgA = generateId();
      const orgB = generateId();
      const now = Date.now();

      const makeJob = (organizationId: string): JobInsert =>
        ({
          id: generateId(),
          organizationId,
          type: "file_upload",
          status: "pending",
          progress: 0,
          metadata: {},
          result: null,
          error: null,
          startedAt: null,
          completedAt: null,
          bullJobId: null,
          attempts: 0,
          maxAttempts: 3,
          created: now,
          createdBy: "test-system",
          updated: null,
          updatedBy: null,
          deleted: null,
          deletedBy: null,
        }) as JobInsert;

      await jobsRepo.create(makeJob(orgA), db);
      await jobsRepo.create(makeJob(orgA), db);
      await jobsRepo.create(makeJob(orgB), db);

      const resultsA = await jobsRepo.findMany(
        undefined,
        { organizationId: orgA },
        db
      );
      const resultsB = await jobsRepo.findMany(
        undefined,
        { organizationId: orgB },
        db
      );

      expect(resultsA).toHaveLength(2);
      expect(resultsB).toHaveLength(1);
    });

    it("should ignore organizationId filter on tables without that column", async () => {
      const user1 = createTestUser();
      const user2 = createTestUser();
      await usersRepo.create(user1, db);
      await usersRepo.create(user2, db);

      const results = await usersRepo.findMany(
        undefined,
        { organizationId: "some-org-id" },
        db
      );

      expect(results).toHaveLength(2);
    });
  });

  describe("count", () => {
    it("should return the count of non-deleted users", async () => {
      await usersRepo.create(createTestUser(), db);
      await usersRepo.create(createTestUser(), db);

      const count = await usersRepo.count(undefined, db);

      expect(count).toBe(2);
    });

    it("should support filtering with where clause", async () => {
      const email = `unique-${generateId()}@example.com`;
      await usersRepo.create(createTestUser({ email }), db);
      await usersRepo.create(createTestUser(), db);

      const count = await usersRepo.count(eq(users.email, email), db);

      expect(count).toBe(1);
    });

    it("should exclude soft-deleted users", async () => {
      const user1 = await usersRepo.create(createTestUser(), db);
      await usersRepo.create(createTestUser(), db);
      await usersRepo.softDelete(user1.id, "test-system", db);

      const count = await usersRepo.count(undefined, db);

      expect(count).toBe(1);
    });
  });

  // ── CREATE TESTS ──────────────────────────────────────────────────

  describe("create", () => {
    it("should insert and return a new user", async () => {
      const userData = createTestUser();

      const result = await usersRepo.create(userData, db);

      expect(result.id).toBe(userData.id);
      expect(result.email).toBe(userData.email);
      expect(result.auth0Id).toBe(userData.auth0Id);
    });

    it("should persist the user to the database", async () => {
      const userData = createTestUser();
      const created = await usersRepo.create(userData, db);

      const found = await usersRepo.findById(created.id, db);

      expect(found).toBeDefined();
      expect(found?.email).toBe(userData.email);
    });
  });

  describe("createMany", () => {
    it("should insert multiple users and return them", async () => {
      const users = [createTestUser(), createTestUser(), createTestUser()];

      const results = await usersRepo.createMany(users, db);

      expect(results).toHaveLength(3);
      expect(results[0].email).toBe(users[0].email);
      expect(results[1].email).toBe(users[1].email);
      expect(results[2].email).toBe(users[2].email);
    });

    it("should return empty array when given empty array", async () => {
      const results = await usersRepo.createMany([], db);

      expect(results).toEqual([]);
    });
  });

  // ── UPSERT TESTS ─────────────────────────────────────────────────

  describe("upsert", () => {
    it("should insert a new row when no conflict exists", async () => {
      const userData = createTestUser();

      const result = await usersRepo.upsert(userData, db);

      expect(result.id).toBe(userData.id);
      expect(result.email).toBe(userData.email);
    });

    it("should update an existing row on id conflict", async () => {
      const userData = createTestUser();
      await usersRepo.create(userData, db);

      const newEmail = `updated-${generateId()}@example.com`;
      const result = await usersRepo.upsert(
        { ...userData, email: newEmail },
        db
      );

      expect(result.id).toBe(userData.id);
      expect(result.email).toBe(newEmail);
    });

    it("should persist the upserted data", async () => {
      const userData = createTestUser();
      await usersRepo.create(userData, db);

      const newName = "Upserted Name";
      await usersRepo.upsert({ ...userData, name: newName }, db);

      const found = await usersRepo.findById(userData.id, db);
      expect(found?.name).toBe(newName);
    });

    it("should not create a duplicate row on conflict", async () => {
      const userData = createTestUser();
      await usersRepo.upsert(userData, db);
      await usersRepo.upsert({ ...userData, name: "Changed" }, db);

      const count = await usersRepo.count(undefined, db);
      expect(count).toBe(1);
    });
  });

  describe("upsertMany", () => {
    it("should insert multiple new rows when no conflicts exist", async () => {
      const users = [createTestUser(), createTestUser(), createTestUser()];

      const results = await usersRepo.upsertMany(users, db);

      expect(results).toHaveLength(3);
      expect(results[0].email).toBe(users[0].email);
      expect(results[1].email).toBe(users[1].email);
      expect(results[2].email).toBe(users[2].email);
    });

    it("should update existing rows on id conflict", async () => {
      const user1 = createTestUser();
      const user2 = createTestUser();
      await usersRepo.createMany([user1, user2], db);

      const newName1 = "Upserted 1";
      const newName2 = "Upserted 2";
      const results = await usersRepo.upsertMany(
        [
          { ...user1, name: newName1 },
          { ...user2, name: newName2 },
        ],
        db
      );

      expect(results).toHaveLength(2);
      const names = results.map((r) => r.name);
      expect(names).toContain(newName1);
      expect(names).toContain(newName2);
    });

    it("should handle a mix of inserts and updates", async () => {
      const existing = createTestUser();
      await usersRepo.create(existing, db);

      const newUser = createTestUser();
      const results = await usersRepo.upsertMany(
        [{ ...existing, name: "Updated Existing" }, newUser],
        db
      );

      expect(results).toHaveLength(2);

      const count = await usersRepo.count(undefined, db);
      expect(count).toBe(2);

      const found = await usersRepo.findById(existing.id, db);
      expect(found?.name).toBe("Updated Existing");
    });

    it("should return empty array when given empty array", async () => {
      const results = await usersRepo.upsertMany([], db);

      expect(results).toEqual([]);
    });

    it("should not create duplicate rows on conflict", async () => {
      const users = [createTestUser(), createTestUser()];
      await usersRepo.createMany(users, db);

      await usersRepo.upsertMany(
        users.map((u) => ({ ...u, name: "Bulk Updated" })),
        db
      );

      const count = await usersRepo.count(undefined, db);
      expect(count).toBe(2);
    });
  });

  // ── UPDATE TESTS ──────────────────────────────────────────────────

  describe("update", () => {
    it("should update a user and return the updated row", async () => {
      const user = await usersRepo.create(createTestUser(), db);
      const newEmail = `updated-${generateId()}@example.com`;

      const result = await usersRepo.update(user.id, { email: newEmail }, db);

      expect(result).toBeDefined();
      expect(result?.email).toBe(newEmail);
    });

    it("should persist the update to the database", async () => {
      const user = await usersRepo.create(createTestUser(), db);
      const newName = "Updated Name";
      await usersRepo.update(user.id, { name: newName }, db);

      const found = await usersRepo.findById(user.id, db);

      expect(found?.name).toBe(newName);
    });

    it("should return undefined for non-existent ID", async () => {
      const result = await usersRepo.update(
        "non-existent",
        { name: "Test" },
        db
      );

      expect(result).toBeUndefined();
    });

    it("should not update soft-deleted users", async () => {
      const user = await usersRepo.create(createTestUser(), db);
      await usersRepo.softDelete(user.id, "test-system", db);

      const result = await usersRepo.update(user.id, { name: "New Name" }, db);

      expect(result).toBeUndefined();
    });
  });

  describe("updateWhere", () => {
    it("should update all matching users", async () => {
      const name = "Original Name";
      await usersRepo.create(createTestUser({ name }), db);
      await usersRepo.create(createTestUser({ name }), db);
      await usersRepo.create(createTestUser({ name: "Different" }), db);

      const results = await usersRepo.updateWhere(
        eq(users.name, name),
        { name: "Updated Name" },
        db
      );

      expect(results).toHaveLength(2);
      expect(results[0].name).toBe("Updated Name");
      expect(results[1].name).toBe("Updated Name");
    });

    it("should not update soft-deleted users", async () => {
      const name = "Target Name";
      const user1 = await usersRepo.create(createTestUser({ name }), db);
      await usersRepo.create(createTestUser({ name }), db);
      await usersRepo.softDelete(user1.id, "test-system", db);

      const results = await usersRepo.updateWhere(
        eq(users.name, name),
        { name: "Updated" },
        db
      );

      expect(results).toHaveLength(1);
    });
  });

  describe("updateMany", () => {
    it("should update multiple users with different data", async () => {
      const user1 = await usersRepo.create(createTestUser(), db);
      const user2 = await usersRepo.create(createTestUser(), db);

      const results = await usersRepo.updateMany(
        [
          { id: user1.id, data: { name: "Updated 1" } },
          { id: user2.id, data: { name: "Updated 2" } },
        ],
        db
      );

      expect(results).toHaveLength(2);
      expect(results[0].name).toBe("Updated 1");
      expect(results[1].name).toBe("Updated 2");
    });

    it("should skip non-existent IDs", async () => {
      const user = await usersRepo.create(createTestUser(), db);

      const results = await usersRepo.updateMany(
        [
          { id: user.id, data: { name: "Updated" } },
          { id: "non-existent", data: { name: "Won't work" } },
        ],
        db
      );

      expect(results).toHaveLength(1);
    });

    it("should return empty array when given empty array", async () => {
      const results = await usersRepo.updateMany([], db);

      expect(results).toEqual([]);
    });
  });

  // ── SOFT DELETE TESTS ─────────────────────────────────────────────

  describe("softDelete", () => {
    it("should soft-delete a user", async () => {
      const user = await usersRepo.create(createTestUser(), db);

      const result = await usersRepo.softDelete(user.id, "admin-user", db);

      expect(result).toBeDefined();
      expect(result?.deleted).not.toBeNull();
      expect(result?.deletedBy).toBe("admin-user");
    });

    it("should make the user invisible to findById", async () => {
      const user = await usersRepo.create(createTestUser(), db);
      await usersRepo.softDelete(user.id, "admin-user", db);

      const found = await usersRepo.findById(user.id, db);

      expect(found).toBeUndefined();
    });

    it("should return undefined for non-existent ID", async () => {
      const result = await usersRepo.softDelete("non-existent", "admin", db);

      expect(result).toBeUndefined();
    });

    it("should not double soft-delete", async () => {
      const user = await usersRepo.create(createTestUser(), db);
      await usersRepo.softDelete(user.id, "admin-user", db);

      const result = await usersRepo.softDelete(user.id, "admin-user", db);

      expect(result).toBeUndefined();
    });
  });

  describe("softDeleteMany", () => {
    it("should soft-delete multiple users", async () => {
      const user1 = await usersRepo.create(createTestUser(), db);
      const user2 = await usersRepo.create(createTestUser(), db);

      const count = await usersRepo.softDeleteMany(
        [user1.id, user2.id],
        "admin-user",
        db
      );

      expect(count).toBe(2);
    });

    it("should make soft-deleted users invisible", async () => {
      const user1 = await usersRepo.create(createTestUser(), db);
      const user2 = await usersRepo.create(createTestUser(), db);
      await usersRepo.softDeleteMany([user1.id, user2.id], "admin", db);

      const results = await usersRepo.findMany(undefined, {}, db);

      expect(results).toHaveLength(0);
    });

    it("should return 0 for empty array", async () => {
      const count = await usersRepo.softDeleteMany([], "admin", db);

      expect(count).toBe(0);
    });
  });

  // ── HARD DELETE TESTS ─────────────────────────────────────────────

  describe("hardDelete", () => {
    it("should permanently delete a user", async () => {
      const user = await usersRepo.create(createTestUser(), db);

      const result = await usersRepo.hardDelete(user.id, db);

      expect(result).toBe(true);
    });

    it("should remove the user from the database", async () => {
      const user = await usersRepo.create(createTestUser(), db);
      await usersRepo.hardDelete(user.id, db);

      const found = await usersRepo.findMany(
        undefined,
        { includeDeleted: true },
        db
      );

      expect(found).toHaveLength(0);
    });

    it("should return false for non-existent ID", async () => {
      const result = await usersRepo.hardDelete("non-existent", db);

      expect(result).toBe(false);
    });

    it("should delete even soft-deleted users", async () => {
      const user = await usersRepo.create(createTestUser(), db);
      await usersRepo.softDelete(user.id, "admin", db);

      const result = await usersRepo.hardDelete(user.id, db);

      expect(result).toBe(true);
    });
  });

  describe("hardDeleteMany", () => {
    it("should permanently delete multiple users", async () => {
      const user1 = await usersRepo.create(createTestUser(), db);
      const user2 = await usersRepo.create(createTestUser(), db);

      const count = await usersRepo.hardDeleteMany([user1.id, user2.id], db);

      expect(count).toBe(2);
    });

    it("should return 0 for empty array", async () => {
      const count = await usersRepo.hardDeleteMany([], db);

      expect(count).toBe(0);
    });
  });

  // ── TRANSACTION TESTS ─────────────────────────────────────────────

  describe("transactions", () => {
    it("should commit when transaction succeeds", async () => {
      await Repository.transaction(async (tx) => {
        await usersRepo.create(createTestUser(), tx);
        await usersRepo.create(createTestUser(), tx);
      });

      const count = await usersRepo.count(undefined, db);

      expect(count).toBe(2);
    });

    it("should rollback when transaction fails", async () => {
      try {
        await Repository.transaction(async (tx) => {
          await usersRepo.create(createTestUser(), tx);
          throw new Error("Intentional error");
        });
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
      } catch (error) {
        // Expected
      }

      const count = await usersRepo.count(undefined, db);

      expect(count).toBe(0);
    });

    it("should support nested repository calls in transaction", async () => {
      const user1 = await usersRepo.create(createTestUser(), db);

      await Repository.transaction(async (tx) => {
        await usersRepo.update(user1.id, { name: "Updated in TX" }, tx);
        const user2 = await usersRepo.create(createTestUser(), tx);
        await usersRepo.softDelete(user2.id, "admin", tx);
      });

      const found = await usersRepo.findById(user1.id, db);
      const count = await usersRepo.count(undefined, db);

      expect(found?.name).toBe("Updated in TX");
      expect(count).toBe(1); // user1 exists, user2 was soft-deleted
    });

    it("should support updateMany with implicit transaction", async () => {
      const user1 = await usersRepo.create(createTestUser(), db);
      const user2 = await usersRepo.create(createTestUser(), db);

      // updateMany creates its own transaction if not provided one
      const results = await usersRepo.updateMany(
        [
          { id: user1.id, data: { name: "Name 1" } },
          { id: user2.id, data: { name: "Name 2" } },
        ],
        db
      );

      expect(results).toHaveLength(2);
    });

    // ── createTransactionClient ──────────────────────────────────

    describe("createTransactionClient", () => {
      it("should persist changes when commit is called", async () => {
        const { tx, commit } = await Repository.createTransactionClient();

        await usersRepo.create(createTestUser(), tx);
        await usersRepo.create(createTestUser(), tx);
        await commit();

        const count = await usersRepo.count(undefined, db);
        expect(count).toBe(2);
      });

      it("should revert changes when rollback is called", async () => {
        const { tx, rollback } = await Repository.createTransactionClient();

        await usersRepo.create(createTestUser(), tx);
        await usersRepo.create(createTestUser(), tx);
        await rollback();

        const count = await usersRepo.count(undefined, db);
        expect(count).toBe(0);
      });

      it("should support multiple repository operations before commit", async () => {
        const { tx, commit } = await Repository.createTransactionClient();

        const user = await usersRepo.create(createTestUser(), tx);
        await usersRepo.update(user.id, { name: "Updated in TX" }, tx);
        const user2 = await usersRepo.create(createTestUser(), tx);
        await usersRepo.softDelete(user2.id, "admin", tx);
        await commit();

        const found = await usersRepo.findById(user.id, db);
        const count = await usersRepo.count(undefined, db);

        expect(found?.name).toBe("Updated in TX");
        expect(count).toBe(1);
      });

      it("should revert all operations when rollback is called after multiple writes", async () => {
        const { tx, rollback } = await Repository.createTransactionClient();

        const user = await usersRepo.create(createTestUser(), tx);
        await usersRepo.update(user.id, { name: "Updated in TX" }, tx);
        await usersRepo.create(createTestUser(), tx);
        await rollback();

        const count = await usersRepo.count(undefined, db);
        expect(count).toBe(0);
      });
    });

    it("should reuse existing transaction when provided", async () => {
      const user1 = await usersRepo.create(createTestUser(), db);
      const user2 = await usersRepo.create(createTestUser(), db);

      await Repository.transaction(async (tx) => {
        // updateMany should reuse the transaction
        await usersRepo.updateMany(
          [
            { id: user1.id, data: { name: "Name 1" } },
            { id: user2.id, data: { name: "Name 2" } },
          ],
          tx
        );
        // If we throw here, both updates should roll back
        throw new Error("Rollback test");
      }).catch(() => {
        // Expected error
      });

      const found1 = await usersRepo.findById(user1.id, db);
      const found2 = await usersRepo.findById(user2.id, db);

      // Names should not have been updated due to rollback
      expect(found1?.name).not.toBe("Name 1");
      expect(found2?.name).not.toBe("Name 2");
    });
  });
});
