/**
 * #802: the `entity_data_delete` processor removes the bulk data of entities a
 * delete already tombstoned — records soft-deleted in batches, the `er__<id>`
 * wide table dropped. Re-delivery is idempotent, and an entity that isn't
 * soft-deleted is never touched.
 */

import { describe, it, expect, beforeEach, afterEach } from "@jest/globals";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { and, eq, isNull } from "drizzle-orm";
import { UnrecoverableError } from "bullmq";

import { entityDataDeleteProcessor } from "../../../queues/processors/entity-data-delete.processor.js";
import { DbService } from "../../../services/db.service.js";
import { wideTableReconcilerService } from "../../../services/wide-table-reconciler.service.js";
import type { DbClient } from "../../../db/repositories/base.repository.js";
import * as schema from "../../../db/schema/index.js";
import { generateId, teardownOrg } from "../utils/application.util.js";
import {
  seedPopulatedOrg,
  wideTableExists,
  type PopulatedOrg,
} from "../utils/seed-populated-org.util.js";

type Db = ReturnType<typeof drizzle>;

const run = (data: Record<string, unknown>) =>
  entityDataDeleteProcessor({
    data: { jobId: generateId(), type: "entity_data_delete", ...data },
    updateProgress: async () => {},
  } as never);

describe("entity_data_delete processor (#802)", () => {
  let connection!: ReturnType<typeof postgres>;
  let db!: Db;
  let org!: PopulatedOrg;

  async function addRecords(entityId: string, n: number) {
    const now = Date.now();
    await db.insert(schema.entityRecords).values(
      Array.from({ length: n }, (_, i) => ({
        id: generateId(),
        organizationId: org.orgId,
        connectorEntityId: entityId,
        data: { email: `r${i}@example.com` },
        sourceId: `extra-${i}-${generateId().slice(0, 6)}`,
        checksum: "sum",
        syncedAt: now,
        origin: "manual",
        isValid: true,
        created: now,
        createdBy: "SYSTEM_TEST",
        updated: null,
        updatedBy: null,
        deleted: null,
        deletedBy: null,
      })) as never
    );
  }

  async function liveRecords(entityId: string): Promise<number> {
    const rows = await db
      .select()
      .from(schema.entityRecords)
      .where(
        and(
          eq(schema.entityRecords.connectorEntityId, entityId),
          isNull(schema.entityRecords.deleted)
        )
      );
    return rows.length;
  }

  async function tombstoneEntity(entityId: string) {
    await db
      .update(schema.connectorEntities)
      .set({ deleted: Date.now(), deletedBy: org.ownerUserId })
      .where(eq(schema.connectorEntities.id, entityId));
  }

  beforeEach(async () => {
    if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL not set");
    connection = postgres(process.env.DATABASE_URL, { max: 2 });
    db = drizzle(connection, { schema });
    await teardownOrg(db);
    org = await seedPopulatedOrg(db, "entity-data-delete");
    await addRecords(org.connectorEntityId, 4); // 5 live with the seeded one
  });

  afterEach(async () => {
    await wideTableReconcilerService.dropTable(
      org.connectorEntityId,
      db as DbClient
    );
    await teardownOrg(db);
    await connection.end();
  });

  it("soft-deletes a deleted entity's records and drops its wide table", async () => {
    await tombstoneEntity(org.connectorEntityId);

    const result = await run({
      organizationId: org.orgId,
      userId: org.ownerUserId,
      connectorEntityIds: [org.connectorEntityId],
      connectorInstanceId: org.connectorInstanceId,
    });

    expect(result).toEqual({ recordsDeleted: 5, wideTablesDropped: 1 });
    expect(await liveRecords(org.connectorEntityId)).toBe(0);
    expect(await wideTableExists(db, org.connectorEntityId)).toBe(false);
    const [tombstone] = await db
      .select()
      .from(schema.entityRecords)
      .where(eq(schema.entityRecords.connectorEntityId, org.connectorEntityId));
    expect(tombstone.deletedBy).toBe(org.ownerUserId);
  });

  it("is idempotent when re-delivered", async () => {
    await tombstoneEntity(org.connectorEntityId);
    const data = {
      organizationId: org.orgId,
      userId: org.ownerUserId,
      connectorEntityIds: [org.connectorEntityId],
      connectorInstanceId: null,
    };
    await run(data);

    expect(await run(data)).toEqual({
      recordsDeleted: 0,
      wideTablesDropped: 0,
    });
  });

  it("never touches an entity that isn't soft-deleted", async () => {
    const result = await run({
      organizationId: org.orgId,
      userId: org.ownerUserId,
      connectorEntityIds: [org.connectorEntityId],
      connectorInstanceId: null,
    });

    expect(result).toEqual({ recordsDeleted: 0, wideTablesDropped: 0 });
    expect(await liveRecords(org.connectorEntityId)).toBe(5);
    expect(await wideTableExists(db, org.connectorEntityId)).toBe(true);
  });

  it("fails unrecoverably on metadata it can't use", async () => {
    await expect(
      run({ organizationId: org.orgId, userId: org.ownerUserId })
    ).rejects.toBeInstanceOf(UnrecoverableError);
  });

  it("the batch primitive deletes at most a batch, and 0 ends the drain", async () => {
    const repo = DbService.repository.entityRecords;
    const id = org.connectorEntityId;

    expect(await repo.softDeleteBatchByConnectorEntityId(id, "u", 2)).toBe(2);
    expect(await repo.softDeleteBatchByConnectorEntityId(id, "u", 2)).toBe(2);
    expect(await repo.softDeleteBatchByConnectorEntityId(id, "u", 2)).toBe(1);
    expect(await repo.softDeleteBatchByConnectorEntityId(id, "u", 2)).toBe(0);
    expect(await liveRecords(id)).toBe(0);
  });
});
