/**
 * Integration tests for the EntityRecordsRepository.
 *
 * Phase D's `softDeleteBeforeWatermark` is the load-bearing primitive for
 * the disappeared-records reconciliation; the watermark semantics demand
 * real SQL behavior, not a mocked repository.
 */

import { describe, it, expect, beforeEach, afterEach } from "@jest/globals";
import { drizzle } from "drizzle-orm/postgres-js";
import { eq } from "drizzle-orm";
import postgres from "postgres";

import { EntityRecordsRepository } from "../../../../db/repositories/entity-records.repository.js";
import type { DbClient } from "../../../../db/repositories/base.repository.js";
import * as schema from "../../../../db/schema/index.js";
import type { EntityRecordInsert } from "../../../../db/schema/zod.js";
import {
  generateId,
  teardownOrg,
  createUser,
  createOrganization,
} from "../../utils/application.util.js";

describe("EntityRecordsRepository Integration Tests", () => {
  let connection!: ReturnType<typeof postgres>;
  let db!: DbClient;
  let repo: EntityRecordsRepository;
  let orgId: string;
  let entityAId: string;
  let entityBId: string;

  beforeEach(async () => {
    if (!process.env.DATABASE_URL) {
      throw new Error("DATABASE_URL not set - setup.ts should have set this");
    }
    connection = postgres(process.env.DATABASE_URL, { max: 1 });
    db = drizzle(connection, { schema });
    repo = new EntityRecordsRepository();

    await teardownOrg(db as ReturnType<typeof drizzle>);

    // Seed user → org → connector definition → connector instance → 2 entities
    const user = createUser(`auth0|${generateId()}`);
    await (db as ReturnType<typeof drizzle>)
      .insert(schema.users)
      .values(user as never);
    const org = createOrganization(user.id);
    await (db as ReturnType<typeof drizzle>)
      .insert(schema.organizations)
      .values(org as never);
    orgId = org.id;

    const connDefId = generateId();
    await (db as ReturnType<typeof drizzle>)
      .insert(schema.connectorDefinitions)
      .values({
        id: connDefId,
        slug: `test-${generateId().slice(0, 8)}`,
        display: "Test",
        category: "crm",
        authType: "none",
        configSchema: {},
        capabilityFlags: { sync: true },
        isActive: true,
        version: "1.0.0",
        iconUrl: null,
        created: Date.now(),
        createdBy: "test",
        updated: null,
        updatedBy: null,
        deleted: null,
        deletedBy: null,
      } as never);

    const ciId = generateId();
    await (db as ReturnType<typeof drizzle>)
      .insert(schema.connectorInstances)
      .values({
        id: ciId,
        connectorDefinitionId: connDefId,
        organizationId: org.id,
        name: "Test",
        status: "active",
        config: {},
        credentials: null,
        lastSyncAt: null,
        lastErrorMessage: null,
        enabledCapabilityFlags: null,
        created: Date.now(),
        createdBy: "test",
        updated: null,
        updatedBy: null,
        deleted: null,
        deletedBy: null,
      } as never);

    for (const key of ["entity_a", "entity_b"] as const) {
      const id = generateId();
      await (db as ReturnType<typeof drizzle>)
        .insert(schema.connectorEntities)
        .values({
          id,
          organizationId: orgId,
          connectorInstanceId: ciId,
          key: `${key}_${generateId().slice(0, 6)}`,
          label: key,
          created: Date.now(),
          createdBy: "test",
          updated: null,
          updatedBy: null,
          deleted: null,
          deletedBy: null,
        } as never);
      if (key === "entity_a") entityAId = id;
      else entityBId = id;
    }
  });

  afterEach(async () => {
    await connection.end();
  });

  // ── Helpers ────────────────────────────────────────────────────────

  function makeRecord(
    connectorEntityId: string,
    overrides: Partial<EntityRecordInsert> = {}
  ): EntityRecordInsert {
    const now = Date.now();
    return {
      id: generateId(),
      organizationId: orgId,
      connectorEntityId,
      data: {},
      normalizedData: {},
      sourceId: `src_${generateId().slice(0, 8)}`,
      checksum: "abc",
      syncedAt: now,
      origin: "sync",
      validationErrors: null,
      isValid: true,
      created: now,
      createdBy: "test",
      updated: null,
      updatedBy: null,
      deleted: null,
      deletedBy: null,
      ...overrides,
    } as EntityRecordInsert;
  }

  async function insertRecord(insert: EntityRecordInsert): Promise<void> {
    await (db as ReturnType<typeof drizzle>)
      .insert(schema.entityRecords)
      .values(insert as never);
  }

  async function readRow(id: string) {
    const rows = await (db as ReturnType<typeof drizzle>)
      .select()
      .from(schema.entityRecords)
      .where(eq(schema.entityRecords.id, id));
    return rows[0];
  }

  // ── softDeleteBeforeWatermark ──────────────────────────────────────

  describe("softDeleteBeforeWatermark", () => {
    it("reaps every row whose syncedAt is below the watermark", async () => {
      const ids = await Promise.all(
        Array.from({ length: 4 }, async () => {
          const r = makeRecord(entityAId, { syncedAt: 100 });
          await insertRecord(r);
          return r.id!;
        })
      );

      const affected = await repo.softDeleteBeforeWatermark(
        entityAId,
        200,
        "user-1",
        db
      );
      expect(affected).toBe(4);

      for (const id of ids) {
        const row = await readRow(id);
        expect(row?.deleted).not.toBeNull();
        expect(row?.deletedBy).toBe("user-1");
      }
    });

    it("spares rows whose syncedAt is at or above the watermark", async () => {
      const oldA = makeRecord(entityAId, { syncedAt: 100 });
      const oldB = makeRecord(entityAId, { syncedAt: 100 });
      const fresh1 = makeRecord(entityAId, { syncedAt: 250 });
      const fresh2 = makeRecord(entityAId, { syncedAt: 300 });
      for (const r of [oldA, oldB, fresh1, fresh2]) await insertRecord(r);

      const affected = await repo.softDeleteBeforeWatermark(
        entityAId,
        200,
        "user-1",
        db
      );
      expect(affected).toBe(2);

      expect((await readRow(oldA.id!))?.deleted).not.toBeNull();
      expect((await readRow(oldB.id!))?.deleted).not.toBeNull();
      expect((await readRow(fresh1.id!))?.deleted).toBeNull();
      expect((await readRow(fresh2.id!))?.deleted).toBeNull();
    });

    it("does not reap rows at exactly the watermark (strict <)", async () => {
      const atWatermark = makeRecord(entityAId, { syncedAt: 200 });
      const belowWatermark = makeRecord(entityAId, { syncedAt: 199 });
      await insertRecord(atWatermark);
      await insertRecord(belowWatermark);

      const affected = await repo.softDeleteBeforeWatermark(
        entityAId,
        200,
        "user-1",
        db
      );
      expect(affected).toBe(1);

      expect((await readRow(atWatermark.id!))?.deleted).toBeNull();
      expect((await readRow(belowWatermark.id!))?.deleted).not.toBeNull();
    });

    it("only touches the supplied entity, not siblings", async () => {
      const aOld = makeRecord(entityAId, { syncedAt: 100 });
      const bOld = makeRecord(entityBId, { syncedAt: 100 });
      await insertRecord(aOld);
      await insertRecord(bOld);

      const affected = await repo.softDeleteBeforeWatermark(
        entityAId,
        200,
        "user-1",
        db
      );
      expect(affected).toBe(1);

      expect((await readRow(aOld.id!))?.deleted).not.toBeNull();
      // Entity B's row stays live.
      expect((await readRow(bOld.id!))?.deleted).toBeNull();
    });

    it("is idempotent — re-running does not re-soft-delete already-deleted rows", async () => {
      const old = makeRecord(entityAId, { syncedAt: 100 });
      await insertRecord(old);

      const first = await repo.softDeleteBeforeWatermark(
        entityAId,
        200,
        "user-1",
        db
      );
      expect(first).toBe(1);
      const firstDeletedAt = (await readRow(old.id!))?.deleted;
      expect(firstDeletedAt).not.toBeNull();

      // Wait a tick so any "now" recompute would observe a different
      // value if the WHERE clause were missing the deleted-IS-NULL guard.
      await new Promise((r) => setTimeout(r, 5));

      const second = await repo.softDeleteBeforeWatermark(
        entityAId,
        200,
        "user-2",
        db
      );
      expect(second).toBe(0);

      const row = await readRow(old.id!);
      // deleted timestamp + deletedBy are unchanged by the no-op second run.
      expect(row?.deleted).toBe(firstDeletedAt);
      expect(row?.deletedBy).toBe("user-1");
    });

    it("returns 0 when nothing matches", async () => {
      // Only fresh rows in the entity.
      await insertRecord(makeRecord(entityAId, { syncedAt: 500 }));
      const affected = await repo.softDeleteBeforeWatermark(
        entityAId,
        200,
        "user-1",
        db
      );
      expect(affected).toBe(0);
    });
  });
});
