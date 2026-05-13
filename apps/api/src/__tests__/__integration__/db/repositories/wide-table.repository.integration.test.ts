/**
 * Integration tests for WideTableRepository (Phase 2 slice 1).
 *
 * Each test reconciles a connector entity (the only DDL path) so the
 * `er__<id>` table is created with the expected columns, then exercises
 * the new write surface (`upsertMany`, `softDeleteByEntityRecordIds`,
 * `selectByEntityRecordIds`) and asserts on what landed on disk.
 *
 * `entity_records` rows are inserted by hand because the wide-table FK
 * (`entity_record_id REFERENCES entity_records(id) ON DELETE CASCADE`)
 * requires the parent row to exist before the upsert.
 */

import { describe, it, expect, beforeEach, afterEach } from "@jest/globals";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { sql } from "drizzle-orm";

import { WideTableReconcilerService } from "../../../../services/wide-table-reconciler.service.js";
import { WideTableStatementCache } from "../../../../services/wide-table-statement.cache.js";
import { WideTableRepository } from "../../../../db/repositories/wide-table.repository.js";
import type { DbClient } from "../../../../db/repositories/base.repository.js";
import * as schema from "../../../../db/schema/index.js";
import {
  generateId,
  teardownOrg,
  createUser,
  createOrganization,
} from "../../utils/application.util.js";

describe("WideTableRepository integration tests", () => {
  let connection!: ReturnType<typeof postgres>;
  let db!: DbClient;
  let reconciler: WideTableReconcilerService;
  let statementCache: WideTableStatementCache;
  let repo: WideTableRepository;
  let orgId: string;
  let entityId: string;
  let fmAmountId: string;
  let fmStageId: string;

  beforeEach(async () => {
    if (!process.env.DATABASE_URL) {
      throw new Error("DATABASE_URL not set - setup.ts should have set this");
    }

    connection = postgres(process.env.DATABASE_URL, { max: 4 });
    db = drizzle(connection, { schema });
    statementCache = new WideTableStatementCache();
    reconciler = new WideTableReconcilerService(
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      statementCache
    );
    repo = new WideTableRepository(statementCache);

    await teardownOrg(db as ReturnType<typeof drizzle>);

    const dbTyped = db as ReturnType<typeof drizzle>;
    const now = Date.now();

    const user = createUser(`auth0|${generateId()}`);
    await dbTyped.insert(schema.users).values(user as never);
    const org = createOrganization(user.id);
    await dbTyped.insert(schema.organizations).values(org as never);
    orgId = org.id;

    const connDefId = generateId();
    await dbTyped.insert(schema.connectorDefinitions).values({
      id: connDefId,
      slug: `test-conn-${generateId().slice(0, 8)}`,
      display: "Test Connector",
      category: "crm",
      authType: "oauth2",
      configSchema: {},
      capabilityFlags: { sync: true },
      isActive: true,
      version: "1.0.0",
      iconUrl: null,
      created: now,
      createdBy: "test-system",
      updated: null,
      updatedBy: null,
      deleted: null,
      deletedBy: null,
    } as never);

    const connectorInstanceId = generateId();
    await dbTyped.insert(schema.connectorInstances).values({
      id: connectorInstanceId,
      connectorDefinitionId: connDefId,
      organizationId: orgId,
      name: "Test Instance",
      status: "active",
      config: {},
      credentials: null,
      lastSyncAt: null,
      lastErrorMessage: null,
      enabledCapabilityFlags: null,
      created: now,
      createdBy: "test-system",
      updated: null,
      updatedBy: null,
      deleted: null,
      deletedBy: null,
    } as never);

    entityId = generateId();
    await dbTyped.insert(schema.connectorEntities).values({
      id: entityId,
      organizationId: orgId,
      connectorInstanceId,
      key: "deals",
      label: "Deals",
      created: now,
      createdBy: "test-system",
      updated: null,
      updatedBy: null,
      deleted: null,
      deletedBy: null,
    } as never);

    // Two column-definitions: numeric and string.
    const cdAmount = generateId();
    const cdStage = generateId();
    await dbTyped.insert(schema.columnDefinitions).values([
      {
        id: cdAmount,
        organizationId: orgId,
        key: "amount",
        label: "Amount",
        type: "number",
        description: null,
        validationPattern: null,
        validationMessage: null,
        canonicalFormat: null,
        system: false,
        created: now,
        createdBy: "test-system",
        updated: null,
        updatedBy: null,
        deleted: null,
        deletedBy: null,
      },
      {
        id: cdStage,
        organizationId: orgId,
        key: "stage",
        label: "Stage",
        type: "string",
        description: null,
        validationPattern: null,
        validationMessage: null,
        canonicalFormat: null,
        system: false,
        created: now,
        createdBy: "test-system",
        updated: null,
        updatedBy: null,
        deleted: null,
        deletedBy: null,
      },
    ] as never);

    fmAmountId = generateId();
    fmStageId = generateId();
    await dbTyped.insert(schema.fieldMappings).values([
      {
        id: fmAmountId,
        organizationId: orgId,
        connectorEntityId: entityId,
        columnDefinitionId: cdAmount,
        sourceField: "Amount",
        isPrimaryKey: false,
        normalizedKey: "amount",
        required: false,
        defaultValue: null,
        format: null,
        enumValues: null,
        refNormalizedKey: null,
        refEntityKey: null,
        created: now,
        createdBy: "test-system",
        updated: null,
        updatedBy: null,
        deleted: null,
        deletedBy: null,
      },
      {
        id: fmStageId,
        organizationId: orgId,
        connectorEntityId: entityId,
        columnDefinitionId: cdStage,
        sourceField: "Stage",
        isPrimaryKey: false,
        normalizedKey: "stage",
        required: false,
        defaultValue: null,
        format: null,
        enumValues: null,
        refNormalizedKey: null,
        refEntityKey: null,
        created: now + 1,
        createdBy: "test-system",
        updated: null,
        updatedBy: null,
        deleted: null,
        deletedBy: null,
      },
    ] as never);

    // Reconciler creates the wide table with metadata + c_amount + c_stage.
    await reconciler.reconcileEntity(entityId, db);
  });

  afterEach(async () => {
    try {
      await reconciler.dropTable(entityId, db);
    } catch {
      /* ignore */
    }
    statementCache.clear();
    await connection.end();
  });

  async function insertEntityRecord(
    id: string,
    sourceId: string,
    extra: Partial<Record<string, unknown>> = {}
  ): Promise<void> {
    const dbTyped = db as ReturnType<typeof drizzle>;
    const now = Date.now();
    await dbTyped.insert(schema.entityRecords).values({
      id,
      organizationId: orgId,
      connectorEntityId: entityId,
      sourceId,
      isValid: true,
      validationErrors: null,
      normalizedData: {},
      syncedAt: now,
      data: {},
      checksum: `checksum-${sourceId}`,
      origin: "sync",
      created: now,
      createdBy: "test-system",
      updated: null,
      updatedBy: null,
      deleted: null,
      deletedBy: null,
      ...extra,
    } as never);
  }

  // ── Case 1 — upsertMany writes one row per record ────────────────

  it("upsertMany writes one row per record with metadata + every live column", async () => {
    const r1 = generateId();
    const r2 = generateId();
    const r3 = generateId();
    await insertEntityRecord(r1, "src-1");
    await insertEntityRecord(r2, "src-2");
    await insertEntityRecord(r3, "src-3");

    const now = Date.now();
    await repo.upsertMany(entityId, [
      {
        entity_record_id: r1,
        organization_id: orgId,
        synced_at: now,
        is_valid: true,
        source_id: "src-1",
        c_amount: 100,
        c_stage: "open",
      },
      {
        entity_record_id: r2,
        organization_id: orgId,
        synced_at: now,
        is_valid: true,
        source_id: "src-2",
        c_amount: 250,
        c_stage: "won",
      },
      {
        entity_record_id: r3,
        organization_id: orgId,
        synced_at: now,
        is_valid: true,
        source_id: "src-3",
        c_amount: 75.5,
        c_stage: "lost",
      },
    ]);

    const rows = (await repo.selectAll(entityId, db)) as Array<
      Record<string, unknown>
    >;
    expect(rows).toHaveLength(3);
    const byId = new Map(rows.map((r) => [r.entity_record_id as string, r]));
    expect(byId.get(r1)!.c_amount).toBe("100");
    expect(byId.get(r1)!.source_id).toBe("src-1");
    expect(byId.get(r2)!.c_stage).toBe("won");
    expect(byId.get(r3)!.is_valid).toBe(true);
  });

  // ── Case 2 — upsertMany is idempotent ────────────────────────────

  it("upsertMany is idempotent (second call updates in place)", async () => {
    const r1 = generateId();
    await insertEntityRecord(r1, "src-1");
    const now = Date.now();

    await repo.upsertMany(entityId, [
      {
        entity_record_id: r1,
        organization_id: orgId,
        synced_at: now,
        is_valid: true,
        source_id: "src-1",
        c_amount: 100,
        c_stage: "open",
      },
    ]);
    await repo.upsertMany(entityId, [
      {
        entity_record_id: r1,
        organization_id: orgId,
        synced_at: now + 1000,
        is_valid: true,
        source_id: "src-1",
        c_amount: 200,
        c_stage: "won",
      },
    ]);

    const rows = (await repo.selectAll(entityId, db)) as Array<
      Record<string, unknown>
    >;
    expect(rows).toHaveLength(1);
    expect(rows[0]!.c_amount).toBe("200");
    expect(rows[0]!.c_stage).toBe("won");
  });

  // ── Case 3 — upsertMany honours retired columns ──────────────────

  it("upsertMany drops unknown / retired columns from the row payload", async () => {
    const r1 = generateId();
    await insertEntityRecord(r1, "src-1");
    const now = Date.now();

    // c_unknown is not in the cache — should be silently dropped, not error.
    await repo.upsertMany(entityId, [
      {
        entity_record_id: r1,
        organization_id: orgId,
        synced_at: now,
        is_valid: true,
        source_id: "src-1",
        c_amount: 100,
        c_unknown: "should be dropped",
      },
    ]);

    const rows = (await repo.selectAll(entityId, db)) as Array<
      Record<string, unknown>
    >;
    expect(rows).toHaveLength(1);
    expect(rows[0]!.c_amount).toBe("100");
    expect("c_unknown" in rows[0]!).toBe(false);
  });

  // ── Case 4 — upsertMany overwrites all live data columns ─────────

  it("upsertMany overwrites every live data column on conflict", async () => {
    const r1 = generateId();
    await insertEntityRecord(r1, "src-1");
    const now = Date.now();

    await repo.upsertMany(entityId, [
      {
        entity_record_id: r1,
        organization_id: orgId,
        synced_at: now,
        is_valid: true,
        source_id: "src-1",
        c_amount: 100,
        c_stage: "open",
      },
    ]);

    // Second upsert omits c_stage — the bulk INSERT shape sets every live
    // column from EXCLUDED, so the omitted column becomes NULL on conflict.
    await repo.upsertMany(entityId, [
      {
        entity_record_id: r1,
        organization_id: orgId,
        synced_at: now,
        is_valid: true,
        source_id: "src-1",
        c_amount: 200,
      },
    ]);

    const rows = (await repo.selectAll(entityId, db)) as Array<
      Record<string, unknown>
    >;
    expect(rows).toHaveLength(1);
    expect(rows[0]!.c_amount).toBe("200");
    expect(rows[0]!.c_stage).toBeNull();
  });

  // ── Case 5 — upsertMany rejects rows missing metadata ────────────

  it("upsertMany throws when a row is missing the entity_record_id PK", async () => {
    await expect(
      repo.upsertMany(entityId, [
        {
          // entity_record_id intentionally omitted
          organization_id: orgId,
          synced_at: Date.now(),
          is_valid: true,
          source_id: "src-1",
          c_amount: 100,
        } as unknown as Record<string, unknown>,
      ])
    ).rejects.toThrow(/missing metadata column "entity_record_id"/);
  });

  // ── Case 6 — softDeleteByEntityRecordIds removes wide rows ───────

  it("softDeleteByEntityRecordIds hard-deletes wide rows", async () => {
    const r1 = generateId();
    const r2 = generateId();
    await insertEntityRecord(r1, "src-1");
    await insertEntityRecord(r2, "src-2");
    const now = Date.now();
    await repo.upsertMany(entityId, [
      {
        entity_record_id: r1,
        organization_id: orgId,
        synced_at: now,
        is_valid: true,
        source_id: "src-1",
      },
      {
        entity_record_id: r2,
        organization_id: orgId,
        synced_at: now,
        is_valid: true,
        source_id: "src-2",
      },
    ]);

    await repo.softDeleteByEntityRecordIds(entityId, [r1]);
    const rows = (await repo.selectAll(entityId, db)) as Array<
      Record<string, unknown>
    >;
    expect(rows).toHaveLength(1);
    expect(rows[0]!.entity_record_id).toBe(r2);
  });

  // ── Case 7 — softDeleteByEntityRecordIds handles missing ids ─────

  it("softDeleteByEntityRecordIds is a no-op for missing ids", async () => {
    await expect(
      repo.softDeleteByEntityRecordIds(entityId, ["does-not-exist"])
    ).resolves.toBeUndefined();
  });

  // ── Case 8 — selectByEntityRecordIds returns the requested set ───

  it("selectByEntityRecordIds returns one row per requested id", async () => {
    const r1 = generateId();
    const r2 = generateId();
    const r3 = generateId();
    await insertEntityRecord(r1, "src-1");
    await insertEntityRecord(r2, "src-2");
    await insertEntityRecord(r3, "src-3");
    const now = Date.now();
    await repo.upsertMany(entityId, [
      {
        entity_record_id: r1,
        organization_id: orgId,
        synced_at: now,
        is_valid: true,
        source_id: "src-1",
      },
      {
        entity_record_id: r2,
        organization_id: orgId,
        synced_at: now,
        is_valid: true,
        source_id: "src-2",
      },
      {
        entity_record_id: r3,
        organization_id: orgId,
        synced_at: now,
        is_valid: true,
        source_id: "src-3",
      },
    ]);

    const rows = (await repo.selectByEntityRecordIds(entityId, [
      r1,
      r3,
    ])) as Array<Record<string, unknown>>;
    expect(rows).toHaveLength(2);
    const ids = new Set(rows.map((r) => r.entity_record_id as string));
    expect(ids).toEqual(new Set([r1, r3]));
  });

  // ── Case 9 — FK cascade: hard-delete entity_records → wide row ───

  it("dropping an entity_records row cascades to the wide table", async () => {
    const r1 = generateId();
    await insertEntityRecord(r1, "src-1");
    const now = Date.now();
    await repo.upsertMany(entityId, [
      {
        entity_record_id: r1,
        organization_id: orgId,
        synced_at: now,
        is_valid: true,
        source_id: "src-1",
      },
    ]);

    await db.execute(
      sql`DELETE FROM entity_records WHERE id = ${r1}`
    );

    const rows = (await repo.selectAll(entityId, db)) as Array<
      Record<string, unknown>
    >;
    expect(rows).toHaveLength(0);
  });

  // ── Large-batch chunking ─────────────────────────────────────────
  //
  // A single 13k-row INSERT used to build a Drizzle `sql` AST whose
  // join tree overflowed V8's call stack at execute time
  // ("Maximum call stack size exceeded"). `upsertMany` now chunks at
  // 500 rows per statement; this test seeds 1,200 rows to exercise
  // the chunk boundary (2 full chunks + 1 partial).

  it("upsertMany chunks large batches and writes every row", async () => {
    const ROW_COUNT = 1_200;
    const now = Date.now();
    const rows: Record<string, unknown>[] = [];
    for (let i = 0; i < ROW_COUNT; i++) {
      const id = generateId();
      await insertEntityRecord(id, `src-batch-${i}`);
      rows.push({
        entity_record_id: id,
        organization_id: orgId,
        synced_at: now,
        is_valid: true,
        source_id: `src-batch-${i}`,
        c_amount: i,
        c_stage: `s-${i % 4}`,
      });
    }

    await repo.upsertMany(entityId, rows);

    const all = (await repo.selectAll(entityId, db)) as Array<
      Record<string, unknown>
    >;
    expect(all).toHaveLength(ROW_COUNT);
  }, 60_000);

  // ── Phase 3 Slice 1 — fetchProjectedRows ─────────────────────────

  it("fetchProjectedRows returns the requested columns keyed by normalizedKey", async () => {
    const r1 = generateId();
    const r2 = generateId();
    await insertEntityRecord(r1, "src-1");
    await insertEntityRecord(r2, "src-2");
    const now = Date.now();
    await repo.upsertMany(entityId, [
      {
        entity_record_id: r1,
        organization_id: orgId,
        synced_at: now,
        is_valid: true,
        source_id: "src-1",
        c_amount: 100,
        c_stage: "open",
      },
      {
        entity_record_id: r2,
        organization_id: orgId,
        synced_at: now,
        is_valid: true,
        source_id: "src-2",
        c_amount: 250,
        c_stage: "won",
      },
    ]);

    const rows = await repo.fetchProjectedRows(
      entityId,
      ["amount"],
      { organizationId: orgId, limit: 10 }
    );
    expect(rows).toHaveLength(2);
    // Each row keyed by _record_id + the requested normalizedKeys.
    expect(rows[0]).toHaveProperty("_record_id");
    expect(rows[0]).toHaveProperty("amount");
    // Numeric column comes back as a stringified number from Postgres.
    const amounts = new Set(rows.map((r) => String(r.amount)));
    expect(amounts).toEqual(new Set(["100", "250"]));
  });

  it("fetchProjectedRows accepts a `where` filter on a typed column", async () => {
    const r1 = generateId();
    const r2 = generateId();
    await insertEntityRecord(r1, "src-1");
    await insertEntityRecord(r2, "src-2");
    const now = Date.now();
    await repo.upsertMany(entityId, [
      {
        entity_record_id: r1,
        organization_id: orgId,
        synced_at: now,
        is_valid: true,
        source_id: "src-1",
        c_amount: 100,
      },
      {
        entity_record_id: r2,
        organization_id: orgId,
        synced_at: now,
        is_valid: true,
        source_id: "src-2",
        c_amount: 250,
      },
    ]);

    const rows = await repo.fetchProjectedRows(
      entityId,
      ["amount"],
      {
        organizationId: orgId,
        where: sql`w."c_amount" > 200`,
      }
    );
    expect(rows).toHaveLength(1);
    expect(String(rows[0]!.amount)).toBe("250");
  });

  it("fetchProjectedRows excludes soft-deleted rows", async () => {
    const r1 = generateId();
    await insertEntityRecord(r1, "src-1");
    const now = Date.now();
    await repo.upsertMany(entityId, [
      {
        entity_record_id: r1,
        organization_id: orgId,
        synced_at: now,
        is_valid: true,
        source_id: "src-1",
        c_amount: 100,
      },
    ]);
    // Soft-delete the entity_records row.
    const { entityRecords: entityRecordsTable } = await import(
      "../../../../db/schema/index.js"
    );
    const drizzleSql = (await import("drizzle-orm")).sql;
    await db.execute(
      drizzleSql`UPDATE ${entityRecordsTable} SET deleted = ${now}, deleted_by = 'test' WHERE id = ${r1}`
    );

    const rows = await repo.fetchProjectedRows(
      entityId,
      ["amount"],
      { organizationId: orgId }
    );
    expect(rows).toHaveLength(0);
  });

  it("fetchProjectedRows throws on unknown normalizedKey", async () => {
    await expect(
      repo.fetchProjectedRows(
        entityId,
        ["does_not_exist"],
        { organizationId: orgId }
      )
    ).rejects.toThrow(/unknown columns/);
  });
});
