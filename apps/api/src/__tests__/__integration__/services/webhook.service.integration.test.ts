/**
 * Integration tests for WebhookService.syncUser().
 *
 * Runs against the real postgres-test database spun up by docker-compose.
 * Verifies user creation, update, and no-op flows end-to-end.
 */

import { describe, it, expect, beforeEach, afterEach } from "@jest/globals";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import type { Auth0WebhookPayload } from "@mcp-ui/core/contracts";
import * as schema from "../../../db/schema/index.js";
import type { DbClient } from "../../../db/repositories/base.repository.js";
import { Repository } from "../../../db/repositories/base.repository.js";
import { WebhookService } from "../../../services/webhook.service.js";

const { users, organizations, organizationUsers } = schema;

describe("WebhookService Integration Tests", () => {
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

  describe("syncUser", () => {
    const basePayload: Auth0WebhookPayload = {
      user_id: "auth0|abc123",
      email: "test@example.com",
      name: "Test User",
      picture: "https://example.com/avatar.png",
    };

    it("should create a new user when not found by auth0Id", async () => {
      const result = await WebhookService.syncUser(basePayload);

      expect(result.action).toBe("created");
      expect(result.userId).toBeDefined();

      // Verify user was persisted
      const usersRepo = new Repository(users);
      const found = await usersRepo.findById(result.userId, db);
      expect(found).toBeDefined();
      expect(found?.auth0Id).toBe("auth0|abc123");
      expect(found?.email).toBe("test@example.com");
      expect(found?.name).toBe("Test User");
      expect(found?.picture).toBe("https://example.com/avatar.png");
    });

    it("should create an organization for the new user", async () => {
      const result = await WebhookService.syncUser(basePayload);

      // Verify organization was created
      const orgsRepo = new Repository(organizations);
      const orgs = await orgsRepo.findMany(undefined, {}, db);
      expect(orgs).toHaveLength(1);
      expect(orgs[0].ownerUserId).toBe(result.userId);
    });

    it("should return unchanged when user exists with same data", async () => {
      // First call creates the user
      const created = await WebhookService.syncUser(basePayload);
      expect(created.action).toBe("created");

      // Second call with identical payload should be unchanged
      const result = await WebhookService.syncUser(basePayload);
      expect(result.action).toBe("unchanged");
      expect(result.userId).toBe(created.userId);
    });

    it("should update user when fields have changed", async () => {
      // Create user first
      const created = await WebhookService.syncUser(basePayload);
      expect(created.action).toBe("created");

      // Update with changed fields
      const updatedPayload: Auth0WebhookPayload = {
        user_id: "auth0|abc123",
        email: "new@example.com",
        name: "New Name",
        picture: "https://example.com/new-avatar.png",
      };

      const result = await WebhookService.syncUser(updatedPayload);
      expect(result.action).toBe("updated");
      expect(result.userId).toBe(created.userId);

      // Verify updated values in the database
      const usersRepo = new Repository(users);
      const found = await usersRepo.findById(result.userId, db);
      expect(found?.email).toBe("new@example.com");
      expect(found?.name).toBe("New Name");
      expect(found?.picture).toBe("https://example.com/new-avatar.png");
    });

    it("should handle user with no email, name, or picture", async () => {
      const minimalPayload: Auth0WebhookPayload = {
        user_id: "auth0|minimal",
      };

      const result = await WebhookService.syncUser(minimalPayload);

      expect(result.action).toBe("created");

      const usersRepo = new Repository(users);
      const found = await usersRepo.findById(result.userId, db);
      expect(found).toBeDefined();
      expect(found?.auth0Id).toBe("auth0|minimal");
      expect(found?.email).toBeNull();
      expect(found?.name).toBeNull();
      expect(found?.picture).toBeNull();
    });

    it("should detect change when email goes from null to a value", async () => {
      // Create user with no email
      const minimalPayload: Auth0WebhookPayload = {
        user_id: "auth0|abc123",
      };
      const created = await WebhookService.syncUser(minimalPayload);
      expect(created.action).toBe("created");

      // Update with email
      const result = await WebhookService.syncUser(basePayload);
      expect(result.action).toBe("updated");

      const usersRepo = new Repository(users);
      const found = await usersRepo.findById(result.userId, db);
      expect(found?.email).toBe("test@example.com");
    });
  });
});
