/**
 * Integration tests for the PortalMessagesRepository.
 *
 * Tests run against a real PostgreSQL database spun up by testcontainers.
 */

import { describe, it, expect, beforeEach, afterEach } from "@jest/globals";
import { drizzle } from "drizzle-orm/postgres-js";
import { eq } from "drizzle-orm";
import postgres from "postgres";

import { PortalMessagesRepository } from "../../../../db/repositories/portal-messages.repository.js";
import type { DbClient } from "../../../../db/repositories/base.repository.js";
import * as schema from "../../../../db/schema/index.js";
import type { PortalMessageInsert } from "../../../../db/schema/zod.js";
import {
  generateId,
  teardownOrg,
  createUser,
  createOrganization,
} from "../../utils/application.util.js";

describe("PortalMessagesRepository Integration Tests", () => {
  let connection!: ReturnType<typeof postgres>;
  let db!: DbClient;
  let repo: PortalMessagesRepository;
  let orgId: string;
  let portalId: string;

  beforeEach(async () => {
    if (!process.env.DATABASE_URL) {
      throw new Error("DATABASE_URL not set - setup.ts should have set this");
    }

    connection = postgres(process.env.DATABASE_URL, { max: 1 });
    db = drizzle(connection, { schema });
    repo = new PortalMessagesRepository();

    await teardownOrg(db as ReturnType<typeof drizzle>);

    const now = Date.now();

    const user = createUser(`auth0|${generateId()}`);
    await (db as ReturnType<typeof drizzle>)
      .insert(schema.users)
      .values(user as never);
    const org = createOrganization(user.id);
    await (db as ReturnType<typeof drizzle>)
      .insert(schema.organizations)
      .values(org as never);
    orgId = org.id;

    const stationId = generateId();
    await (db as ReturnType<typeof drizzle>).insert(schema.stations).values({
      id: stationId,
      organizationId: orgId,
      name: "Test Station",
      description: null,
      toolPacks: ["data_query"],
      created: now,
      createdBy: "SYSTEM_TEST",
      updated: null,
      updatedBy: null,
      deleted: null,
      deletedBy: null,
    } as never);

    portalId = generateId();
    await (db as ReturnType<typeof drizzle>).insert(schema.portals).values({
      id: portalId,
      organizationId: orgId,
      stationId,
      name: "Test Portal",
      created: now,
      createdBy: "SYSTEM_TEST",
      updated: null,
      updatedBy: null,
      deleted: null,
      deletedBy: null,
    } as never);
  });

  afterEach(async () => {
    await connection.end();
  });

  // ── Helpers ──────────────────────────────────────────────────────

  function makeMessage(
    overrides?: Partial<PortalMessageInsert>
  ): PortalMessageInsert {
    const now = Date.now();
    return {
      id: generateId(),
      portalId,
      organizationId: orgId,
      role: "user",
      blocks: [{ type: "text", text: "hello" }],
      created: now,
      createdBy: "SYSTEM_TEST",
      updated: null,
      updatedBy: null,
      deleted: null,
      deletedBy: null,
      ...overrides,
    } as PortalMessageInsert;
  }

  // ── create ─────────────────────────────────────────────────────

  describe("create", () => {
    it("should insert a message with blocks and return the full row", async () => {
      const blocks = [{ type: "text", text: "What are my top customers?" }];
      const data = makeMessage({ role: "user", blocks });
      const created = await repo.create(data, db);

      expect(created.id).toBe(data.id);
      expect(created.portalId).toBe(portalId);
      expect(created.organizationId).toBe(orgId);
      expect(created.role).toBe("user");
      expect(created.blocks).toEqual(blocks);
    });
  });

  // ── findByPortal ───────────────────────────────────────────────

  describe("findByPortal", () => {
    it("should return messages ordered by created ascending", async () => {
      const baseTime = Date.now();

      const msg1 = makeMessage({
        role: "user",
        blocks: [{ type: "text", text: "first" }],
        created: baseTime,
      });
      const msg2 = makeMessage({
        role: "assistant",
        blocks: [{ type: "text", text: "second" }],
        created: baseTime + 1000,
      });
      const msg3 = makeMessage({
        role: "user",
        blocks: [{ type: "text", text: "third" }],
        created: baseTime + 2000,
      });

      // Insert out of order to verify sorting
      await repo.create(msg3, db);
      await repo.create(msg1, db);
      await repo.create(msg2, db);

      const results = await repo.findByPortal(portalId, db);

      expect(results).toHaveLength(3);
      expect(results[0].id).toBe(msg1.id);
      expect(results[1].id).toBe(msg2.id);
      expect(results[2].id).toBe(msg3.id);
    });

    it("should return empty array for unknown portal", async () => {
      const results = await repo.findByPortal("unknown-portal-id", db);
      expect(results).toHaveLength(0);
    });
  });

  // ── deleteByPortal ────────────────────────────────────────────

  describe("deleteByPortal", () => {
    it("should delete all messages for a portal and return the count", async () => {
      const baseTime = Date.now();
      await repo.create(makeMessage({ created: baseTime }), db);
      await repo.create(makeMessage({ created: baseTime + 1000 }), db);
      await repo.create(makeMessage({ created: baseTime + 2000 }), db);

      const count = await repo.deleteByPortal(portalId, db);

      expect(count).toBe(3);
      const remaining = await repo.findByPortal(portalId, db);
      expect(remaining).toHaveLength(0);
    });

    it("should return 0 when portal has no messages", async () => {
      const count = await repo.deleteByPortal(portalId, db);
      expect(count).toBe(0);
    });

    it("should not delete messages from other portals", async () => {
      // Create a second portal
      const otherPortalId = generateId();
      await (db as ReturnType<typeof drizzle>).insert(schema.portals).values({
        id: otherPortalId,
        organizationId: orgId,
        stationId: (
          await (db as ReturnType<typeof drizzle>)
            .select()
            .from(schema.portals)
            .where(eq(schema.portals.id, portalId))
        )[0].stationId,
        name: "Other Portal",
        created: Date.now(),
        createdBy: "SYSTEM_TEST",
        updated: null,
        updatedBy: null,
        deleted: null,
        deletedBy: null,
      } as never);

      await repo.create(makeMessage(), db);
      await repo.create(makeMessage({ portalId: otherPortalId }), db);

      await repo.deleteByPortal(portalId, db);

      const remaining = await repo.findByPortal(otherPortalId, db);
      expect(remaining).toHaveLength(1);
    });
  });
});
