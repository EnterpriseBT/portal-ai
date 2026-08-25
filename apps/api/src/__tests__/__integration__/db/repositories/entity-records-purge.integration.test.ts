/**
 * Integration tests for the soft-delete retention purge (#442).
 *
 * `entity_records` rows are only ever soft-deleted, and nothing purged them,
 * so the table grew monotonically. The cost is not disk: tombstones count
 * toward `reltuples`, which sets the autoanalyze threshold at
 * `50 + 0.1 × reltuples`, and stale statistics are what made the sync's
 * per-record lookup mis-plan at 36ms/record before #440 batched it.
 *
 * The retention rule splits on **whether the parent `connector_entity` is
 * deleted** — a discriminator derivable from the existing schema, so no new
 * column and no backfill (nothing recorded *why* the 3.9M rows already on
 * disk died). Rows whose parent entity is gone can never be referenced
 * again and get a short window; rows under a live parent may still be worth
 * recovering by hand and get a long one.
 *
 * Two things these tests exist to pin, because both are load-bearing and
 * neither is obvious from the method body:
 *
 *  - **The scopes are complementary and exhaustive.** Every tombstone falls
 *    in exactly one, so the two windows together cannot strand a row
 *    forever, and cannot delete one twice.
 *  - **The wide-table row goes with it, via the FK, not via code.** The
 *    `er__<id>` PK is `REFERENCES entity_records(id) ON DELETE CASCADE`
 *    (`wide-table-reconciler.service.ts:186`), so a hard DELETE reclaims the
 *    projection automatically. #423's comment says the same thing from the
 *    other direction — that cascade "never fires" on the soft-delete path
 *    precisely because it is an UPDATE. The ticket asked for an
 *    application-level cascade; the schema already does it, so what needs
 *    proving is that it fires.
 */

import { describe, it, expect, beforeEach, afterEach } from "@jest/globals";
import { drizzle } from "drizzle-orm/postgres-js";
import { sql } from "drizzle-orm";
import postgres from "postgres";

import { EntityRecordsRepository } from "../../../../db/repositories/entity-records.repository.js";
import type { DbClient } from "../../../../db/repositories/base.repository.js";
import { WideTableReconcilerService } from "../../../../services/wide-table-reconciler.service.js";
import { wideTableStatementCache } from "../../../../services/wide-table-statement.cache.js";
import * as schema from "../../../../db/schema/index.js";
import {
  generateId,
  teardownOrg,
  createUser,
  createOrganization,
} from "../../utils/application.util.js";

const DAY = 24 * 60 * 60 * 1000;

describe("EntityRecordsRepository.purgeTombstonedBefore (#442)", () => {
  let connection: ReturnType<typeof postgres>;
  let db!: DbClient;
  /** The same handle, typed for direct inserts/queries in the fixture. */
  let dbq!: ReturnType<typeof drizzle>;
  let repo: EntityRecordsRepository;
  let reconciler: WideTableReconcilerService;

  let orgId: string;
  let userId: string;
  /** Parent entity that is still live — its tombstones are scope "live". */
  let liveEntityId: string;
  /** Parent entity that is soft-deleted — its tombstones are scope "orphan". */
  let deadEntityId: string;

  const now = Date.now();
  /** Comfortably inside any window under test. */
  const OLD = now - 90 * DAY;
  /** Comfortably outside it. */
  const RECENT = now - 1 * DAY;

  const insertRecord = async (
    entityId: string,
    opts: { deleted: number | null; sourceId?: string }
  ): Promise<string> => {
    const id = generateId();
    await dbq.insert(schema.entityRecords).values({
      id,
      organizationId: orgId,
      connectorEntityId: entityId,
      data: { n: 1 },
      sourceId: opts.sourceId ?? `src-${id}`,
      checksum: `sum-${id}`,
      syncedAt: now,
      origin: "sync",
      validationErrors: null,
      isValid: true,
      created: now,
      createdBy: userId,
      updated: null,
      updatedBy: null,
      deleted: opts.deleted,
      deletedBy: opts.deleted === null ? null : userId,
    } as never);
    return id;
  };

  const liveCount = async (entityId: string): Promise<number> => {
    const r = (await dbq.execute(
      sql`SELECT count(*)::int AS c FROM entity_records
          WHERE connector_entity_id = ${entityId} AND deleted IS NULL`
    )) as unknown as Array<{ c: number }>;
    return r[0].c;
  };

  const totalCount = async (entityId: string): Promise<number> => {
    const r = (await dbq.execute(
      sql`SELECT count(*)::int AS c FROM entity_records
          WHERE connector_entity_id = ${entityId}`
    )) as unknown as Array<{ c: number }>;
    return r[0].c;
  };

  beforeEach(async () => {
    if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL not set");
    connection = postgres(process.env.DATABASE_URL, { max: 1 });
    dbq = drizzle(connection, { schema });
    db = dbq as DbClient;
    repo = new EntityRecordsRepository();
    reconciler = new WideTableReconcilerService();

    await teardownOrg(dbq);

    const user = createUser(`auth0|${generateId()}`);
    await dbq.insert(schema.users).values(user as never);
    userId = user.id;
    const org = createOrganization(user.id);
    await dbq.insert(schema.organizations).values(org as never);
    orgId = org.id;

    const connDefId = generateId();
    await dbq.insert(schema.connectorDefinitions).values({
      id: connDefId,
      slug: `purge-${generateId().slice(0, 8)}`,
      display: "Purge",
      category: "crm",
      authType: "none",
      configSchema: {},
      capabilityFlags: { sync: true },
      isActive: true,
      version: "1.0.0",
      iconUrl: null,
      created: now,
      createdBy: "test",
      updated: null,
      updatedBy: null,
      deleted: null,
      deletedBy: null,
    } as never);

    const ciId = generateId();
    await dbq.insert(schema.connectorInstances).values({
      id: ciId,
      connectorDefinitionId: connDefId,
      organizationId: orgId,
      name: "Purge",
      status: "active",
      config: {},
      credentials: null,
      lastSyncAt: null,
      lastErrorMessage: null,
      enabledCapabilityFlags: null,
      created: now,
      createdBy: "test",
      updated: null,
      updatedBy: null,
      deleted: null,
      deletedBy: null,
    } as never);

    liveEntityId = generateId();
    deadEntityId = generateId();
    for (const [id, deleted] of [
      [liveEntityId, null],
      [deadEntityId, now - 120 * DAY],
    ] as Array<[string, number | null]>) {
      await dbq.insert(schema.connectorEntities).values({
        id,
        organizationId: orgId,
        connectorInstanceId: ciId,
        key: `ent_${id.slice(0, 6)}`,
        label: "Parcels",
        created: now,
        createdBy: "test",
        updated: null,
        updatedBy: null,
        deleted,
        deletedBy: deleted === null ? null : userId,
      } as never);
    }
  });

  afterEach(async () => {
    wideTableStatementCache.clear();
    await reconciler.dropTable(liveEntityId, db).catch(() => undefined);
    await teardownOrg(dbq);
    await connection.end();
  });

  it('scope "orphan" purges only tombstones whose parent entity is deleted', async () => {
    await insertRecord(deadEntityId, { deleted: OLD });
    await insertRecord(deadEntityId, { deleted: OLD });
    await insertRecord(liveEntityId, { deleted: OLD });

    const purged = await repo.purgeTombstonedBefore(now, 1000, "orphan", db);

    expect(purged).toBe(2);
    expect(await totalCount(deadEntityId)).toBe(0);
    expect(await totalCount(liveEntityId)).toBe(1);
  });

  it('scope "live" purges only tombstones whose parent entity is live', async () => {
    await insertRecord(deadEntityId, { deleted: OLD });
    await insertRecord(liveEntityId, { deleted: OLD });
    await insertRecord(liveEntityId, { deleted: OLD });

    const purged = await repo.purgeTombstonedBefore(now, 1000, "live", db);

    expect(purged).toBe(2);
    expect(await totalCount(liveEntityId)).toBe(0);
    expect(await totalCount(deadEntityId)).toBe(1);
  });

  it("never touches a live record, in either scope (ticket AC 3)", async () => {
    // A mix under BOTH parents — the shape the smoke walk checks on the
    // real table, where the live count is the one number that must not move.
    await insertRecord(liveEntityId, { deleted: null });
    await insertRecord(liveEntityId, { deleted: null });
    await insertRecord(liveEntityId, { deleted: OLD });
    await insertRecord(deadEntityId, { deleted: null });
    await insertRecord(deadEntityId, { deleted: OLD });

    const liveBefore = await liveCount(liveEntityId);
    const deadBefore = await liveCount(deadEntityId);

    await repo.purgeTombstonedBefore(now, 1000, "orphan", db);
    await repo.purgeTombstonedBefore(now, 1000, "live", db);

    expect(await liveCount(liveEntityId)).toBe(liveBefore);
    expect(await liveCount(deadEntityId)).toBe(deadBefore);
    // Only the two tombstones went.
    expect(await totalCount(liveEntityId)).toBe(2);
    expect(await totalCount(deadEntityId)).toBe(1);
  });

  it("the two scopes are complementary — together they drain every eligible tombstone", async () => {
    for (let i = 0; i < 4; i++)
      await insertRecord(liveEntityId, { deleted: OLD });
    for (let i = 0; i < 3; i++)
      await insertRecord(deadEntityId, { deleted: OLD });

    const a = await repo.purgeTombstonedBefore(now, 1000, "orphan", db);
    const b = await repo.purgeTombstonedBefore(now, 1000, "live", db);

    // No tombstone counted twice, none stranded.
    expect(a + b).toBe(7);
    expect(await totalCount(liveEntityId)).toBe(0);
    expect(await totalCount(deadEntityId)).toBe(0);
  });

  it("respects batchSize so each statement's lock stays bounded", async () => {
    for (let i = 0; i < 25; i++)
      await insertRecord(liveEntityId, { deleted: OLD });

    expect(await repo.purgeTombstonedBefore(now, 10, "live", db)).toBe(10);
    expect(await repo.purgeTombstonedBefore(now, 10, "live", db)).toBe(10);
    expect(await repo.purgeTombstonedBefore(now, 10, "live", db)).toBe(5);
    // The processor's drain loop terminates on this zero.
    expect(await repo.purgeTombstonedBefore(now, 10, "live", db)).toBe(0);
  });

  it("leaves a tombstone newer than the cutoff alone", async () => {
    await insertRecord(liveEntityId, { deleted: RECENT });
    await insertRecord(liveEntityId, { deleted: OLD });

    const cutoff = now - 30 * DAY;
    expect(await repo.purgeTombstonedBefore(cutoff, 1000, "live", db)).toBe(1);
    expect(await totalCount(liveEntityId)).toBe(1);
  });

  it("returns 0 on an empty backlog", async () => {
    expect(await repo.purgeTombstonedBefore(now, 1000, "live", db)).toBe(0);
    expect(await repo.purgeTombstonedBefore(now, 1000, "orphan", db)).toBe(0);
  });

  it("the FK cascade reclaims the wide-table row (ticket AC 1)", async () => {
    // The whole of deliverable 3 — asserted against the schema's cascade
    // rather than against application code, because there is none.
    await reconciler.reconcileEntity(liveEntityId, db);
    const wideTable = `er__${liveEntityId}`;

    const keptId = await insertRecord(liveEntityId, { deleted: null });
    const doomedId = await insertRecord(liveEntityId, { deleted: OLD });
    for (const id of [keptId, doomedId]) {
      await dbq.execute(
        sql`INSERT INTO ${sql.identifier(wideTable)}
              ("entity_record_id", "organization_id", "synced_at", "is_valid", "source_id")
            VALUES (${id}, ${orgId}, ${now}, true, ${`src-${id}`})`
      );
    }

    const wideIds = async (): Promise<string[]> => {
      const r = (await dbq.execute(
        sql`SELECT entity_record_id AS id FROM ${sql.identifier(wideTable)} ORDER BY 1`
      )) as unknown as Array<{ id: string }>;
      return r.map((x) => x.id);
    };

    expect((await wideIds()).sort()).toEqual([keptId, doomedId].sort());

    await repo.purgeTombstonedBefore(now, 1000, "live", db);

    // The doomed record's projection went with it; the live one stayed.
    expect(await wideIds()).toEqual([keptId]);
  });
});
