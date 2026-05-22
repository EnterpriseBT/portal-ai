import { describe, it, expect, beforeEach, afterEach } from "@jest/globals";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { eq } from "drizzle-orm";

import * as schema from "../../../../db/schema/index.js";
import type { DbClient } from "../../../../db/repositories/base.repository.js";
import { ApiEndpointsRepository } from "../../../../db/repositories/api-endpoints.repository.js";
import {
  generateId,
  teardownOrg,
  createUser,
  createOrganization,
} from "../../utils/application.util.js";

describe("ApiEndpointsRepository Integration Tests", () => {
  let connection!: ReturnType<typeof postgres>;
  let db!: DbClient;
  let repo: ApiEndpointsRepository;
  let orgId: string;
  let connectorInstanceId: string;
  let connDefId: string;
  let actor: string;

  beforeEach(async () => {
    if (!process.env.DATABASE_URL) {
      throw new Error("DATABASE_URL not set");
    }

    connection = postgres(process.env.DATABASE_URL, { max: 1 });
    db = drizzle(connection, { schema });
    repo = new ApiEndpointsRepository();

    await teardownOrg(db as ReturnType<typeof drizzle>);

    const user = createUser(`auth0|${generateId()}`);
    await (db as ReturnType<typeof drizzle>)
      .insert(schema.users)
      .values(user as never);
    actor = user.id;

    const org = createOrganization(user.id);
    await (db as ReturnType<typeof drizzle>)
      .insert(schema.organizations)
      .values(org as never);
    orgId = org.id;

    connDefId = generateId();
    await (db as ReturnType<typeof drizzle>)
      .insert(schema.connectorDefinitions)
      .values({
        id: connDefId,
        slug: `rest-api-${generateId().slice(0, 8)}`,
        display: "REST API",
        category: "api",
        authType: "none",
        configSchema: null,
        capabilityFlags: { sync: true, read: true },
        isActive: true,
        version: "0.1.0",
        iconUrl: null,
        created: Date.now(),
        createdBy: actor,
        updated: null,
        updatedBy: null,
        deleted: null,
        deletedBy: null,
      } as never);

    connectorInstanceId = generateId();
    await (db as ReturnType<typeof drizzle>)
      .insert(schema.connectorInstances)
      .values({
        id: connectorInstanceId,
        connectorDefinitionId: connDefId,
        organizationId: orgId,
        name: "Test REST API Instance",
        status: "active",
        config: { baseUrl: "https://api.example.com", auth: { mode: "none" } },
        credentials: null,
        lastSyncAt: null,
        lastErrorMessage: null,
        enabledCapabilityFlags: null,
        created: Date.now(),
        createdBy: actor,
        updated: null,
        updatedBy: null,
        deleted: null,
        deletedBy: null,
      } as never);
  });

  afterEach(async () => {
    await connection.end();
  });

  describe("findByInstance", () => {
    it("returns empty array when no endpoints configured", async () => {
      const rows = await repo.findByInstance(connectorInstanceId, db);
      expect(rows).toEqual([]);
    });

    it("returns joined { entity, config } after createWithEntity", async () => {
      const created = await repo.createWithEntity(
        {
          organizationId: orgId,
          connectorInstanceId,
          key: "users",
          label: "Users",
          config: {
            path: "/users",
            method: "GET",
            pagination: "none",
            recordsPath: "",
            idField: "id",
          },
        },
        actor,
        db
      );

      const rows = await repo.findByInstance(connectorInstanceId, db);
      expect(rows).toHaveLength(1);
      expect(rows[0].entity.id).toBe(created.entity.id);
      expect(rows[0].entity.key).toBe("users");
      expect(rows[0].config.path).toBe("/users");
      expect(rows[0].config.method).toBe("GET");
      expect(rows[0].config.idField).toBe("id");
    });
  });

  describe("findByEntityId", () => {
    it("returns the joined row", async () => {
      const created = await repo.createWithEntity(
        {
          organizationId: orgId,
          connectorInstanceId,
          key: "posts",
          label: "Posts",
          config: {
            path: "/posts",
            method: "GET",
            pagination: "none",
            recordsPath: "data",
          },
        },
        actor,
        db
      );

      const found = await repo.findByEntityId(created.entity.id, db);
      expect(found).not.toBeNull();
      expect(found!.config.recordsPath).toBe("data");
    });

    it("returns null for unknown entity id", async () => {
      const found = await repo.findByEntityId("does-not-exist", db);
      expect(found).toBeNull();
    });

    it("returns null after soft-delete", async () => {
      const created = await repo.createWithEntity(
        {
          organizationId: orgId,
          connectorInstanceId,
          key: "tags",
          label: "Tags",
          config: {
            path: "/tags",
            method: "GET",
            pagination: "none",
          },
        },
        actor,
        db
      );

      await repo.softDeleteWithEntity(created.entity.id, actor, db);

      const found = await repo.findByEntityId(created.entity.id, db);
      expect(found).toBeNull();
    });
  });

  describe("updateConfig", () => {
    it("patches only config columns; entity row untouched", async () => {
      const created = await repo.createWithEntity(
        {
          organizationId: orgId,
          connectorInstanceId,
          key: "items",
          label: "Items",
          config: {
            path: "/items",
            method: "GET",
            pagination: "none",
          },
        },
        actor,
        db
      );

      const updated = await repo.updateConfig(
        created.entity.id,
        { path: "/items/v2", idField: "uuid" },
        actor,
        db
      );

      expect(updated).not.toBeNull();
      expect(updated!.config.path).toBe("/items/v2");
      expect(updated!.config.idField).toBe("uuid");
      expect(updated!.entity.id).toBe(created.entity.id);
      expect(updated!.entity.label).toBe("Items");
    });
  });

  describe("softDeleteWithEntity", () => {
    it("soft-deletes both rows atomically", async () => {
      const created = await repo.createWithEntity(
        {
          organizationId: orgId,
          connectorInstanceId,
          key: "orders",
          label: "Orders",
          config: { path: "/orders", method: "GET", pagination: "none" },
        },
        actor,
        db
      );

      const ok = await repo.softDeleteWithEntity(created.entity.id, actor, db);
      expect(ok).toBe(true);

      const [entityRow] = await (db as ReturnType<typeof drizzle>)
        .select()
        .from(schema.connectorEntities)
        .where(eq(schema.connectorEntities.id, created.entity.id));
      expect(entityRow.deleted).not.toBeNull();

      const [configRow] = await (db as ReturnType<typeof drizzle>)
        .select()
        .from(schema.apiEndpointConfigs)
        .where(eq(schema.apiEndpointConfigs.id, created.config.id));
      expect(configRow.deleted).not.toBeNull();
    });

    it("returns false when nothing to delete", async () => {
      const ok = await repo.softDeleteWithEntity("nope", actor, db);
      expect(ok).toBe(false);
    });
  });

  describe("CHECK constraints", () => {
    it("rejects method values outside (GET, POST)", async () => {
      await expect(
        repo.createWithEntity(
          {
            organizationId: orgId,
            connectorInstanceId,
            key: "broken-method",
            label: "Broken",
            config: {
              path: "/x",
              method: "PATCH" as never,
              pagination: "none",
            },
          },
          actor,
          db
        )
      ).rejects.toThrow();
    });

    it("rejects pagination values other than 'none' in phase 1", async () => {
      await expect(
        repo.createWithEntity(
          {
            organizationId: orgId,
            connectorInstanceId,
            key: "broken-pagination",
            label: "Broken",
            config: {
              path: "/x",
              method: "GET",
              pagination: "pageOffset",
            },
          },
          actor,
          db
        )
      ).rejects.toThrow();
    });
  });
});
