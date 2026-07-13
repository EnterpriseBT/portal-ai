/**
 * Integration tests for the wide-table boot drift check.
 *
 * The drift check is the `reconcileAll()` call wired into `index.ts`'s
 * bootstrap sequence. These tests invoke `reconcileAll` directly
 * against a seeded database — they don't actually start the HTTP
 * listener; that's exercised by the end-to-end smoke check in
 * `npm run dev`.
 */

import { describe, it, expect, beforeEach, afterEach } from "@jest/globals";
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

describe("Wide-table boot drift check", () => {
  let connection!: ReturnType<typeof postgres>;
  let db!: DbClient;
  let reconciler: WideTableReconcilerService;
  let statementCache: WideTableStatementCache;
  let orgId: string;
  let connectorInstanceId: string;
  let entityIds: string[];
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

    entityIds = [generateId(), generateId(), generateId()];
    await dbTyped.insert(schema.connectorEntities).values(
      entityIds.map((id, i) => ({
        id,
        organizationId: orgId,
        connectorInstanceId,
        key: `entity_${i}`,
        label: `Entity ${i}`,
        created: now,
        createdBy: "test-system",
        updated: null,
        updatedBy: null,
        deleted: null,
        deletedBy: null,
      })) as never[]
    );

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

    // Two field-mappings on each entity.
    for (const eId of entityIds) {
      await dbTyped.insert(schema.fieldMappings).values([
        {
          id: generateId(),
          organizationId: orgId,
          connectorEntityId: eId,
          columnDefinitionId: columnDefIdNumber,
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
          id: generateId(),
          organizationId: orgId,
          connectorEntityId: eId,
          columnDefinitionId: columnDefIdString,
          sourceField: "Stage",
          isPrimaryKey: false,
          normalizedKey: "stage",
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
      ] as never[]);
    }
  });

  afterEach(async () => {
    for (const id of entityIds) {
      try {
        await reconciler.dropTable(id, db);
      } catch {
        /* ignore */
      }
    }
    statementCache.clear();
    await connection.end();
  });

  async function infoSchemaColumns(tableName: string): Promise<Set<string>> {
    const result = await db.execute<{ column_name: string }>(
      sql`SELECT column_name FROM information_schema.columns WHERE table_name = ${tableName}`
    );
    return new Set(
      (result as unknown as { column_name: string }[]).map((r) => r.column_name)
    );
  }

  // ── Case 30 — clean state reconciliation ─────────────────────────

  it("reconcileAll creates wide tables for every live connector_entity", async () => {
    const result = await reconciler.reconcileAll();
    expect(result.reconciled).toBeGreaterThanOrEqual(entityIds.length);

    for (const eId of entityIds) {
      const cols = await infoSchemaColumns(`er__${eId}`);
      expect(cols.has("entity_record_id")).toBe(true);
      expect(cols.has("c_amount")).toBe(true);
      expect(cols.has("c_stage")).toBe(true);
    }
  });

  // ── Case 31 — idempotent on already-reconciled state ─────────────

  it("reconcileAll is idempotent on an already-reconciled database", async () => {
    await reconciler.reconcileAll();

    // Second run emits no DDL — measured via statement-cache invalidations.
    let invalidations = 0;
    const realInvalidate = statementCache.invalidate.bind(statementCache);
    statementCache.invalidate = (id: string) => {
      invalidations++;
      realInvalidate(id);
    };

    const result = await reconciler.reconcileAll();
    expect(result.reconciled).toBeGreaterThanOrEqual(entityIds.length);
    expect(invalidations).toBe(0);
  });

  // ── Case 32 — drift triggers WIDE_TABLE_TYPE_CHANGE_UNSUPPORTED ──

  it("reconcileAll throws when wide_table_columns has stale pg_type", async () => {
    // First run reconciles cleanly.
    await reconciler.reconcileAll();

    // Inject drift: flip a wide_table_columns row's pg_type so it no
    // longer matches the column-definition.
    const targetEntity = entityIds[0]!;
    await db
      .update(schema.wideTableColumns)
      .set({ pgType: "text" } as never)
      .where(
        sql`${schema.wideTableColumns.connectorEntityId} = ${targetEntity}
            AND ${schema.wideTableColumns.columnName} = 'c_amount'`
      );

    await expect(reconciler.reconcileAll()).rejects.toMatchObject({
      code: ApiCode.WIDE_TABLE_TYPE_CHANGE_UNSUPPORTED,
    });
  });
});
