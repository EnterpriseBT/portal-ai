/**
 * Integration tests for WideTableReconcilerService.
 *
 * Each test seeds a connector_entity + field_mappings + column_definitions,
 * then exercises a reconciler method, then asserts on
 * `information_schema.columns`, `wide_table_columns`, and the
 * statement-cache state.
 */

import {
  describe,
  it,
  expect,
  beforeEach,
  afterEach,
  jest,
} from "@jest/globals";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { sql } from "drizzle-orm";

import { WideTableReconcilerService } from "../../../services/wide-table-reconciler.service.js";
import { WideTableStatementCache } from "../../../services/wide-table-statement.cache.js";
import { ApiCode } from "../../../constants/api-codes.constants.js";
import type { DbClient } from "../../../db/repositories/base.repository.js";
import * as schema from "../../../db/schema/index.js";
import {
  generateId,
  teardownOrg,
  createUser,
  createOrganization,
} from "../utils/application.util.js";

describe("WideTableReconcilerService integration tests", () => {
  let connection!: ReturnType<typeof postgres>;
  let db!: DbClient;
  let reconciler: WideTableReconcilerService;
  let statementCache: WideTableStatementCache;
  let orgId: string;
  let connectorInstanceId: string;
  let entityId: string;
  let entityId2: string;
  let columnDefIdNumber: string;
  let columnDefIdString: string;

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

    connectorInstanceId = generateId();
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
    entityId2 = generateId();
    await dbTyped.insert(schema.connectorEntities).values([
      {
        id: entityId,
        organizationId: orgId,
        connectorInstanceId,
        key: "contacts",
        label: "Contacts",
        created: now,
        createdBy: "test-system",
        updated: null,
        updatedBy: null,
        deleted: null,
        deletedBy: null,
      },
      {
        id: entityId2,
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
      },
    ] as never);

    columnDefIdNumber = generateId();
    columnDefIdString = generateId();
    await dbTyped.insert(schema.columnDefinitions).values([
      {
        id: columnDefIdNumber,
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
        id: columnDefIdString,
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
  });

  afterEach(async () => {
    // Drop any wide tables that the reconciler might have created.
    for (const id of [entityId, entityId2]) {
      try {
        await reconciler.dropTable(id, db);
      } catch {
        /* ignore */
      }
    }
    statementCache.clear();
    await connection.end();
  });

  // ── Helpers ──────────────────────────────────────────────────────

  async function seedFieldMapping(
    fieldMappingId: string,
    overrides: {
      entityId?: string;
      columnDefinitionId?: string;
      normalizedKey: string;
      sourceField?: string;
    }
  ) {
    const dbTyped = db as ReturnType<typeof drizzle>;
    await dbTyped.insert(schema.fieldMappings).values({
      id: fieldMappingId,
      organizationId: orgId,
      connectorEntityId: overrides.entityId ?? entityId,
      columnDefinitionId: overrides.columnDefinitionId ?? columnDefIdNumber,
      sourceField: overrides.sourceField ?? "Source",
      isPrimaryKey: false,
      normalizedKey: overrides.normalizedKey,
      required: false,
      defaultValue: null,
      format: null,
      enumValues: null,
      refNormalizedKey: null,
      refEntityKey: null,
      created: Date.now(),
      createdBy: "test-system",
      updated: null,
      updatedBy: null,
      deleted: null,
      deletedBy: null,
    } as never);
  }

  async function infoSchemaColumns(tableName: string): Promise<string[]> {
    const result = await db.execute<{ column_name: string }>(
      sql`SELECT column_name FROM information_schema.columns WHERE table_name = ${tableName}`
    );
    const rows = (result as unknown) as { column_name: string }[];
    return rows.map((r) => r.column_name);
  }

  // ── Case 8 — ensureTable creates metadata columns ────────────────

  it("ensureTable creates the four metadata columns", async () => {
    await reconciler.ensureTable(entityId, db);
    const cols = await infoSchemaColumns(`er__${entityId}`);
    expect(new Set(cols)).toEqual(
      new Set(["entity_record_id", "organization_id", "synced_at", "is_valid"])
    );
  });

  // ── Case 9 — ensureTable idempotent ──────────────────────────────

  it("ensureTable is idempotent", async () => {
    await reconciler.ensureTable(entityId, db);
    await reconciler.ensureTable(entityId, db);
    const cols = await infoSchemaColumns(`er__${entityId}`);
    expect(cols).toHaveLength(4);
  });

  // ── Case 10 — reconcileEntity adds one column per mapping ────────

  it("reconcileEntity adds one column per new field-mapping", async () => {
    const fm1 = generateId();
    const fm2 = generateId();
    const fm3 = generateId();
    await seedFieldMapping(fm1, { normalizedKey: "amount" });
    await seedFieldMapping(fm2, {
      normalizedKey: "stage",
      columnDefinitionId: columnDefIdString,
    });
    await seedFieldMapping(fm3, { normalizedKey: "close_date" });

    await reconciler.reconcileEntity(entityId, db);

    const cols = await infoSchemaColumns(`er__${entityId}`);
    expect(cols).toContain("c_amount");
    expect(cols).toContain("c_stage");
    expect(cols).toContain("c_close_date");

    const meta = await db
      .select()
      .from(schema.wideTableColumns)
      .where(sql`${schema.wideTableColumns.connectorEntityId} = ${entityId}`);
    expect(meta).toHaveLength(3);
  });

  // ── Case 11 — reconcileEntity is a no-op when desired = actual ───

  it("reconcileEntity is a no-op when desired matches actual", async () => {
    const fm1 = generateId();
    await seedFieldMapping(fm1, { normalizedKey: "amount" });

    await reconciler.reconcileEntity(entityId, db);
    const invalidateSpy = jest.spyOn(statementCache, "invalidate");

    await reconciler.reconcileEntity(entityId, db);
    expect(invalidateSpy).not.toHaveBeenCalled();
    invalidateSpy.mockRestore();
  });

  // ── Case 12 — reconcileEntity retires soft-deleted mappings ──────

  it("retires soft-deleted mappings; column stays on disk; selectAll excludes it", async () => {
    const fm1 = generateId();
    const fm2 = generateId();
    await seedFieldMapping(fm1, { normalizedKey: "amount" });
    await seedFieldMapping(fm2, {
      normalizedKey: "stage",
      columnDefinitionId: columnDefIdString,
    });

    await reconciler.reconcileEntity(entityId, db);

    // Soft-delete fm2.
    await db
      .update(schema.fieldMappings)
      .set({ deleted: Date.now(), deletedBy: "test-system" } as never)
      .where(sql`${schema.fieldMappings.id} = ${fm2}`);

    await reconciler.reconcileEntity(entityId, db);

    // Postgres column still exists.
    const cols = await infoSchemaColumns(`er__${entityId}`);
    expect(cols).toContain("c_stage");

    // Metadata row marked retired.
    const meta = await db
      .select()
      .from(schema.wideTableColumns)
      .where(sql`${schema.wideTableColumns.fieldMappingId} = ${fm2}`);
    expect(meta).toHaveLength(1);
    expect(meta[0]!.retiredAt).not.toBeNull();

    // selectAllSql omits retired column.
    const stmt = await statementCache.get(entityId, db);
    expect(stmt.selectAllSql).not.toContain('"c_stage"');
    expect(stmt.selectAllSql).toContain('"c_amount"');
  });

  // ── Case 13 — type-change refusal ────────────────────────────────

  it("refuses type changes with WIDE_TABLE_TYPE_CHANGE_UNSUPPORTED", async () => {
    const fm1 = generateId();
    await seedFieldMapping(fm1, { normalizedKey: "value" });
    await reconciler.reconcileEntity(entityId, db);

    // Switch the field-mapping to point at the string-typed column-def.
    await db
      .update(schema.fieldMappings)
      .set({ columnDefinitionId: columnDefIdString } as never)
      .where(sql`${schema.fieldMappings.id} = ${fm1}`);

    await expect(reconciler.reconcileEntity(entityId, db)).rejects.toMatchObject(
      { code: ApiCode.WIDE_TABLE_TYPE_CHANGE_UNSUPPORTED }
    );
  });

  // ── Case 14 — column-name collision suffix ───────────────────────

  it("resolves column-name collisions with _2/_3 suffixes", async () => {
    const fm1 = generateId();
    const fm2 = generateId();
    const fm3 = generateId();
    // Three normalized_keys all sanitise to the same `c_amt` base.
    await seedFieldMapping(fm1, { normalizedKey: "amt" });
    await seedFieldMapping(fm2, {
      normalizedKey: "AMT",
      columnDefinitionId: columnDefIdString,
    });
    await seedFieldMapping(fm3, {
      normalizedKey: "amt!",
      columnDefinitionId: columnDefIdString,
    });

    await reconciler.reconcileEntity(entityId, db);

    const cols = await infoSchemaColumns(`er__${entityId}`);
    expect(cols).toContain("c_amt");
    expect(cols).toContain("c_amt_2");
    expect(cols).toContain("c_amt_3");
  });

  // ── Case 15 — reconcileAll covers every live entity ──────────────

  it("reconcileAll covers every live connector entity", async () => {
    const fm1 = generateId();
    const fm2 = generateId();
    await seedFieldMapping(fm1, {
      entityId,
      normalizedKey: "amount",
    });
    await seedFieldMapping(fm2, {
      entityId: entityId2,
      normalizedKey: "amount",
    });

    const result = await reconciler.reconcileAll();
    expect(result.reconciled).toBeGreaterThanOrEqual(2);

    const cols1 = await infoSchemaColumns(`er__${entityId}`);
    const cols2 = await infoSchemaColumns(`er__${entityId2}`);
    expect(cols1).toContain("c_amount");
    expect(cols2).toContain("c_amount");
  });

  // ── Case 16 — reconcileAll skips soft-deleted entities ───────────

  it("reconcileAll skips soft-deleted entities", async () => {
    // Soft-delete entityId2.
    await db
      .update(schema.connectorEntities)
      .set({ deleted: Date.now(), deletedBy: "test-system" } as never)
      .where(sql`${schema.connectorEntities.id} = ${entityId2}`);

    await reconciler.reconcileAll();

    // entity1 wide table exists; entity2 wide table does not.
    const cols1 = await infoSchemaColumns(`er__${entityId}`);
    expect(cols1.length).toBeGreaterThanOrEqual(4);

    const cols2 = await infoSchemaColumns(`er__${entityId2}`);
    expect(cols2).toHaveLength(0);
  });

  // ── Case 17 — dropTable removes table + metadata ─────────────────

  it("dropTable removes the table and all metadata rows", async () => {
    const fm1 = generateId();
    await seedFieldMapping(fm1, { normalizedKey: "amount" });
    await reconciler.reconcileEntity(entityId, db);

    expect(await infoSchemaColumns(`er__${entityId}`)).toHaveLength(5);

    await reconciler.dropTable(entityId, db);

    expect(await infoSchemaColumns(`er__${entityId}`)).toHaveLength(0);
    const meta = await db
      .select()
      .from(schema.wideTableColumns)
      .where(sql`${schema.wideTableColumns.connectorEntityId} = ${entityId}`);
    expect(meta).toHaveLength(0);
  });
});
