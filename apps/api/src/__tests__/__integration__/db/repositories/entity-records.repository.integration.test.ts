/**
 * Integration tests for the EntityRecordsRepository.
 *
 * Phase D's `softDeleteBeforeWatermark` is the load-bearing primitive for
 * the disappeared-records reconciliation; the watermark semantics demand
 * real SQL behavior, not a mocked repository.
 *
 * `softDeleteByConnectorEntityId(s)` are covered here for the same reason
 * plus one more (#423): they must report the affected-row count WITHOUT
 * `RETURNING *`. Streaming every matched row — each carrying its `data`
 * JSONB — back into Node to compute `result.length` OOM-killed the API
 * task on a 200K-record entity. Only real SQL can prove the driver's
 * affected-row count is what these methods return, so the count
 * assertions below are what pin that behavior.
 */

import { describe, it, expect, beforeEach, afterEach } from "@jest/globals";
import { drizzle } from "drizzle-orm/postgres-js";
import { eq, sql } from "drizzle-orm";
import postgres from "postgres";

import { EntityRecordsRepository } from "../../../../db/repositories/entity-records.repository.js";
import { WideTableReconcilerService } from "../../../../services/wide-table-reconciler.service.js";
import { wideTableStatementCache } from "../../../../services/wide-table-statement.cache.js";
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
      expect(affected).toHaveLength(4);

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
      expect(affected).toHaveLength(2);

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
      expect(affected).toHaveLength(1);

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
      expect(affected).toHaveLength(1);

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
      expect(first).toHaveLength(1);
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
      expect(second).toHaveLength(0);

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
      expect(affected).toHaveLength(0);
    });
  });

  // ── softDeleteByConnectorEntityIds (#423) ──────────────────────────

  describe("softDeleteByConnectorEntityIds", () => {
    it("reports the affected-row count and soft-deletes every matched row", async () => {
      const ids = await Promise.all(
        Array.from({ length: 5 }, async () => {
          const r = makeRecord(entityAId);
          await insertRecord(r);
          return r.id!;
        })
      );

      const affected = await repo.softDeleteByConnectorEntityIds(
        [entityAId],
        "user-1",
        db
      );

      // A number, not a row array — the whole point of the fix.
      expect(affected).toBe(5);
      for (const id of ids) {
        const row = await readRow(id);
        expect(row?.deleted).not.toBeNull();
        expect(row?.deletedBy).toBe("user-1");
      }
    });

    it("spans every supplied entity and counts them together", async () => {
      for (const _ of [0, 1, 2]) await insertRecord(makeRecord(entityAId));
      for (const _ of [0, 1]) await insertRecord(makeRecord(entityBId));

      const affected = await repo.softDeleteByConnectorEntityIds(
        [entityAId, entityBId],
        "user-1",
        db
      );
      expect(affected).toBe(5);
    });

    it("only touches the supplied entity, not siblings", async () => {
      const target = makeRecord(entityAId);
      const sibling = makeRecord(entityBId);
      await insertRecord(target);
      await insertRecord(sibling);

      const affected = await repo.softDeleteByConnectorEntityIds(
        [entityAId],
        "user-1",
        db
      );
      expect(affected).toBe(1);
      expect((await readRow(target.id!))?.deleted).not.toBeNull();
      expect((await readRow(sibling.id!))?.deleted).toBeNull();
    });

    it("excludes already-deleted rows — a second call reports 0", async () => {
      for (const _ of [0, 1, 2]) await insertRecord(makeRecord(entityAId));

      expect(
        await repo.softDeleteByConnectorEntityIds([entityAId], "user-1", db)
      ).toBe(3);
      expect(
        await repo.softDeleteByConnectorEntityIds([entityAId], "user-2", db)
      ).toBe(0);
    });

    it("returns 0 when the entity holds no live rows", async () => {
      expect(
        await repo.softDeleteByConnectorEntityIds([entityAId], "user-1", db)
      ).toBe(0);
    });

    it("returns 0 for an empty id list without issuing a statement", async () => {
      await insertRecord(makeRecord(entityAId));
      expect(await repo.softDeleteByConnectorEntityIds([], "user-1", db)).toBe(
        0
      );
    });
  });

  // ── softDeleteByConnectorEntityId — singular variant (#423) ────────

  describe("softDeleteByConnectorEntityId", () => {
    it("reports the affected-row count and soft-deletes every matched row", async () => {
      const ids = await Promise.all(
        Array.from({ length: 4 }, async () => {
          const r = makeRecord(entityAId);
          await insertRecord(r);
          return r.id!;
        })
      );

      const affected = await repo.softDeleteByConnectorEntityId(
        entityAId,
        "user-1",
        db
      );

      expect(affected).toBe(4);
      for (const id of ids) {
        expect((await readRow(id))?.deleted).not.toBeNull();
      }
    });

    it("only touches the supplied entity, and is idempotent", async () => {
      await insertRecord(makeRecord(entityAId));
      const sibling = makeRecord(entityBId);
      await insertRecord(sibling);

      expect(
        await repo.softDeleteByConnectorEntityId(entityAId, "user-1", db)
      ).toBe(1);
      expect(
        await repo.softDeleteByConnectorEntityId(entityAId, "user-1", db)
      ).toBe(0);
      expect((await readRow(sibling.id!))?.deleted).toBeNull();
    });
  });

  // ── #433: findHydratedMany ORDER BY tiebreaker ────────────────────

  describe("findHydratedMany ORDER BY tiebreaker (#433)", () => {
    /**
     * The list endpoint's read path. `created` is the UI's default sort and
     * ties are routine — a connector sync can stamp thousands of rows in the
     * same millisecond — so without a unique tiebreaker the page boundaries
     * fall at arbitrary points and rows repeat or vanish between pages.
     */
    const reconciler = new WideTableReconcilerService();

    beforeEach(async () => {
      // Metadata-only wide table: findHydratedMany JOINs it, but this slice
      // needs no typed data columns.
      await reconciler.ensureTable(entityAId, db);
    });

    afterEach(async () => {
      await reconciler.dropTable(entityAId, db).catch(() => undefined);
      wideTableStatementCache.clear();
    });

    /** Insert `count` records that all share one `created` value. */
    async function seedTiedRecords(count: number): Promise<string[]> {
      const tied = Date.now();
      const ids: string[] = [];
      for (let i = 0; i < count; i++) {
        const record = makeRecord(entityAId, { created: tied });
        await insertRecord(record);
        await (db as ReturnType<typeof drizzle>).execute(
          sql`INSERT INTO ${sql.identifier(`er__${entityAId}`)}
              ("entity_record_id", "organization_id", "synced_at", "is_valid", "source_id")
              VALUES (${record.id!}, ${orgId}, ${record.syncedAt!}, true, ${record.sourceId!})`
        );
        ids.push(record.id!);
      }
      return ids;
    }

    it("pages tied rows in id order, exactly once each", async () => {
      const ids = await seedTiedRecords(7);

      const seen: string[] = [];
      for (let offset = 0; offset < 7; offset += 2) {
        const page = await repo.findHydratedMany(
          entityAId,
          {
            limit: 2,
            offset,
            orderBy: { column: schema.entityRecords.created, direction: "asc" },
          },
          db
        );
        seen.push(...page.map((r) => r.id));
      }

      expect(seen).toHaveLength(7);
      expect(new Set(seen).size).toBe(7);
      expect(seen).toEqual([...ids].sort());
    });

    it("omits the raw `data` payload when includeData is false", async () => {
      await seedTiedRecords(2);

      const rows = await repo.findHydratedMany(
        entityAId,
        { includeData: false },
        db
      );

      expect(rows).toHaveLength(2);
      for (const row of rows) {
        expect(row).not.toHaveProperty("data");
        // Everything the table actually renders from is still there.
        expect(row).toHaveProperty("normalizedData");
        expect(row).toHaveProperty("isValid");
        expect(row.id).toBeDefined();
      }
    });

    it("keeps `data` by default, so other callers are unaffected", async () => {
      await seedTiedRecords(1);

      const [row] = await repo.findHydratedMany(entityAId, {}, db);

      expect(row).toHaveProperty("data");
    });

    it("still returns `data` from findHydratedById", async () => {
      const [id] = await seedTiedRecords(1);

      const row = await repo.findHydratedById(id, entityAId, db);

      // The detail view is why `data` is kept on the record at all.
      expect(row).toBeDefined();
      expect(row).toHaveProperty("data");
    });

    it("reverses the tiebreaker when sorting descending", async () => {
      const ids = await seedTiedRecords(5);

      const rows = await repo.findHydratedMany(
        entityAId,
        {
          orderBy: { column: schema.entityRecords.created, direction: "desc" },
        },
        db
      );

      expect(rows.map((r) => r.id)).toEqual([...ids].sort().reverse());
    });
  });
  // ── #440 slice 1: the batched change-detection read ──────────────────
  //
  // The sync loop's per-record lookup degrades quadratically once
  // statistics go stale: the planner abandons
  // `entity_records_entity_source_unique` for the non-covering
  // `entity_records_entity_is_valid_idx` and filters every row already
  // inserted for the entity (measured 36.0ms/record vs 0.45ms). The whole
  // premise of batching the read rather than folding the checksum into
  // `ON CONFLICT` is that a multi-id `= ANY(...)` cannot degrade that way,
  // because both columns land in the index condition and no residual
  // `Filter` remains.
  //
  // These cases are the gate on that premise. If the plan below ever shows
  // a `Filter` on `source_id`, the contract in
  // `docs/CONNECTOR_SYNC_WRITE_PATH.spec.md` (Key decision 2) is wrong.
  describe("findBySourceIdsForSync", () => {
    it("excludes soft-deleted rows (no resurrection)", async () => {
      const live = makeRecord(entityAId, { sourceId: "keep-me" });
      const gone = makeRecord(entityAId, {
        sourceId: "reaped",
        deleted: Date.now(),
        deletedBy: "test",
      });
      await db.insert(schema.entityRecords).values([live, gone] as never);

      const rows = await repo.findBySourceIdsForSync(
        entityAId,
        ["keep-me", "reaped"],
        db
      );

      expect(rows.map((r) => r.sourceId)).toEqual(["keep-me"]);
    });

    it("returns one row per matching source id, projected", async () => {
      const recs = Array.from({ length: 25 }, (_, i) =>
        makeRecord(entityAId, { sourceId: `s-${i}`, checksum: `c-${i}` })
      );
      await db.insert(schema.entityRecords).values(recs as never);

      const rows = await repo.findBySourceIdsForSync(
        entityAId,
        recs.map((r) => r.sourceId as string),
        db
      );

      expect(rows).toHaveLength(25);
      expect(Object.keys(rows[0]).sort()).toEqual([
        "checksum",
        "created",
        "createdBy",
        "id",
        "sourceId",
      ]);
    });

    it("returns exactly the requested rows from a 1000-id batch", async () => {
      // The batched read is the shape the sync writer will issue. Assert its
      // CORRECTNESS here; the query *plan* is deliberately not asserted —
      // see the note below.
      const recs = Array.from({ length: 2_000 }, (_, i) =>
        makeRecord(entityAId, { sourceId: `bulk-${i}`, checksum: `c-${i}` })
      );
      for (let i = 0; i < recs.length; i += 500) {
        await db
          .insert(schema.entityRecords)
          .values(recs.slice(i, i + 500) as never);
      }
      // A row on another entity with a colliding source id — must not leak.
      await db
        .insert(schema.entityRecords)
        .values([makeRecord(entityBId, { sourceId: "bulk-0" })] as never);

      const probe = recs.slice(0, 1_000).map((r) => r.sourceId as string);
      const rows = await repo.findBySourceIdsForSync(entityAId, probe, db);

      expect(rows).toHaveLength(1_000);
      expect(new Set(rows.map((r) => r.sourceId))).toEqual(new Set(probe));
      // Checksums come back paired with their own source id.
      const byId = new Map(rows.map((r) => [r.sourceId, r.checksum]));
      expect(byId.get("bulk-7")).toBe("c-7");
    });

    // ── Why there is no query-plan assertion here ────────────────────────
    //
    // The premise behind batching the read rather than folding the checksum
    // into `ON CONFLICT` (spec Key decision 2) is that a multi-id
    // `= ANY(...)` puts both columns in the index condition and leaves no
    // residual `Filter` to degrade. That was measured on the dev database at
    // production scale — 2.7M rows, ~400K for the entity — where a 1000-id
    // batch planned as:
    //
    //   Index Scan using entity_records_entity_source_unique
    //     Index Cond: ((connector_entity_id = ...) AND (source_id = ANY (...)))
    //   Execution Time: 1.108 ms   (vs 36.015 ms PER RECORD for the
    //                               single-id form on stale statistics)
    //
    // An assertion on that plan was written here first and removed, because
    // this suite's table is ~2,000 rows: both before and after `ANALYZE` the
    // planner correctly prefers a sequential scan with `source_id` as a
    // filter, since scanning 2,000 rows beats 1,000 index probes. The plan
    // is therefore size-dependent, and pinning it in a fixture three orders
    // of magnitude smaller than production would assert the planner's
    // behaviour on data that does not resemble the case it matters for — it
    // would fail permanently while proving nothing.
    //
    // The premise consequently rests on a production-scale measurement, not
    // on a test. Its known limit: it was taken with reasonably fresh
    // statistics, so "batched reads never degrade on stale statistics at
    // scale" is supported but not proven. If it ever does degrade, the
    // robust fix is to make `entity_records_entity_source_unique` covering
    // (INCLUDE checksum, created, created_by) so the planner prefers it
    // regardless of estimates — a migration, deliberately not in this
    // ticket's scope.
  });
});
