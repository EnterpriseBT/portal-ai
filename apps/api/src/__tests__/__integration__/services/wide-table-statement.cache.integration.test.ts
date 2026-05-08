/**
 * Integration tests for WideTableStatementCache.
 *
 * Seeds rows directly into `wide_table_columns` via the repo (no
 * reconciler involved yet — that's slice 4). Asserts the generated
 * SQL strings cover every live column and are deterministically
 * ordered.
 */

import { describe, it, expect, beforeEach, afterEach } from "@jest/globals";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

import { WideTableStatementCache } from "../../../services/wide-table-statement.cache.js";
import { WideTableColumnsRepository } from "../../../db/repositories/wide-table-columns.repository.js";
import type { DbClient } from "../../../db/repositories/base.repository.js";
import type { WideTableColumnInsert } from "../../../db/schema/zod.js";
import * as schema from "../../../db/schema/index.js";
import {
  generateId,
  teardownOrg,
  createUser,
  createOrganization,
} from "../utils/application.util.js";

describe("WideTableStatementCache integration tests", () => {
  let connection!: ReturnType<typeof postgres>;
  let db!: DbClient;
  let columnsRepo: WideTableColumnsRepository;
  let cache: WideTableStatementCache;
  let orgId: string;
  let connectorEntityId: string;
  let columnDefinitionId: string;
  let fieldMappingIds: string[];

  beforeEach(async () => {
    if (!process.env.DATABASE_URL) {
      throw new Error("DATABASE_URL not set - setup.ts should have set this");
    }

    connection = postgres(process.env.DATABASE_URL, { max: 2 });
    db = drizzle(connection, { schema });
    columnsRepo = new WideTableColumnsRepository();
    cache = new WideTableStatementCache(columnsRepo);

    await teardownOrg(db as ReturnType<typeof drizzle>);

    const now = Date.now();
    const dbTyped = db as ReturnType<typeof drizzle>;

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

    const instanceId = generateId();
    await dbTyped.insert(schema.connectorInstances).values({
      id: instanceId,
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

    connectorEntityId = generateId();
    await dbTyped.insert(schema.connectorEntities).values({
      id: connectorEntityId,
      organizationId: orgId,
      connectorInstanceId: instanceId,
      key: "contacts",
      label: "Contacts",
      created: now,
      createdBy: "test-system",
      updated: null,
      updatedBy: null,
      deleted: null,
      deletedBy: null,
    } as never);

    columnDefinitionId = generateId();
    await dbTyped.insert(schema.columnDefinitions).values({
      id: columnDefinitionId,
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
    } as never);

    // Three field-mappings with deterministically distinct created
    // timestamps so the cache's order assertion is reliable.
    fieldMappingIds = [generateId(), generateId(), generateId()];
    for (let i = 0; i < fieldMappingIds.length; i++) {
      await dbTyped.insert(schema.fieldMappings).values({
        id: fieldMappingIds[i],
        organizationId: orgId,
        connectorEntityId,
        columnDefinitionId,
        sourceField: `Source${i}`,
        isPrimaryKey: false,
        normalizedKey: `nk_${i}`,
        required: false,
        defaultValue: null,
        format: null,
        enumValues: null,
        refNormalizedKey: null,
        refEntityKey: null,
        created: now + i,
        createdBy: "test-system",
        updated: null,
        updatedBy: null,
        deleted: null,
        deletedBy: null,
      } as never);
    }
  });

  afterEach(async () => {
    cache.clear();
    await connection.end();
  });

  // ── Helper ──────────────────────────────────────────────────────

  function makeCol(
    overrides: Partial<WideTableColumnInsert> & { columnName: string }
  ): WideTableColumnInsert {
    return {
      id: generateId(),
      organizationId: orgId,
      connectorEntityId,
      fieldMappingId: fieldMappingIds[0]!,
      columnDefinitionId,
      pgType: "numeric",
      retiredAt: null,
      created: Date.now(),
      createdBy: "test-system",
      updated: null,
      updatedBy: null,
      deleted: null,
      deletedBy: null,
      ...overrides,
    } as WideTableColumnInsert;
  }

  // ── Case 18 — lazy build + memoisation ───────────────────────────

  it("get() lazily builds and memoises until invalidate", async () => {
    await columnsRepo.create(
      makeCol({ columnName: "c_amount", fieldMappingId: fieldMappingIds[0]! }),
      db
    );

    const first = await cache.get(connectorEntityId, db);
    const second = await cache.get(connectorEntityId, db);
    expect(second).toBe(first); // same reference — memoised

    cache.invalidate(connectorEntityId);
    const third = await cache.get(connectorEntityId, db);
    expect(third).not.toBe(first);
  });

  // ── Case 19 — invalidate bumps schemaVersion ─────────────────────

  it("invalidate() increments schemaVersion across rebuilds", async () => {
    await columnsRepo.create(
      makeCol({ columnName: "c_amount", fieldMappingId: fieldMappingIds[0]! }),
      db
    );

    const v0 = (await cache.get(connectorEntityId, db)).schemaVersion;
    cache.invalidate(connectorEntityId);
    const v1 = (await cache.get(connectorEntityId, db)).schemaVersion;
    cache.invalidate(connectorEntityId);
    const v2 = (await cache.get(connectorEntityId, db)).schemaVersion;
    expect(v1).toBeGreaterThan(v0);
    expect(v2).toBeGreaterThan(v1);
  });

  // ── Case 20 — selectAllSql ordering ──────────────────────────────

  it("selectAllSql lists metadata columns first, then data columns by created/id", async () => {
    // Insert the data columns out of created-time order to verify the
    // repo's ORDER BY is the source of truth (not insert order).
    await columnsRepo.create(
      makeCol({
        columnName: "c_two",
        created: 2_000,
        fieldMappingId: fieldMappingIds[1]!,
      }),
      db
    );
    await columnsRepo.create(
      makeCol({
        columnName: "c_one",
        created: 1_000,
        fieldMappingId: fieldMappingIds[0]!,
      }),
      db
    );
    await columnsRepo.create(
      makeCol({
        columnName: "c_three",
        created: 3_000,
        fieldMappingId: fieldMappingIds[2]!,
      }),
      db
    );

    const stmt = await cache.get(connectorEntityId, db);
    expect(stmt.selectAllSql).toBe(
      `SELECT "entity_record_id", "organization_id", "synced_at", "is_valid", "c_one", "c_two", "c_three" FROM "er__${connectorEntityId}"`
    );
    expect(stmt.columns.map((c) => c.columnName)).toEqual([
      "c_one",
      "c_two",
      "c_three",
    ]);
  });

  // ── Case 21 — insertSqlTemplate shape, retired columns omitted ───

  it("insertSqlTemplate covers live columns and omits retired ones", async () => {
    const liveRow = await columnsRepo.create(
      makeCol({
        columnName: "c_a",
        created: 1_000,
        fieldMappingId: fieldMappingIds[0]!,
      }),
      db
    );
    const retiredRow = await columnsRepo.create(
      makeCol({
        columnName: "c_b",
        created: 2_000,
        fieldMappingId: fieldMappingIds[1]!,
      }),
      db
    );
    await columnsRepo.markRetired(retiredRow.id, Date.now(), "test-system", db);

    const stmt = await cache.get(connectorEntityId, db);

    // c_a is live — appears in column list and SET clause.
    expect(stmt.insertSqlTemplate).toContain('"c_a"');
    expect(stmt.insertSqlTemplate).toContain('"c_a" = EXCLUDED."c_a"');

    // c_b is retired — appears nowhere in the template.
    expect(stmt.insertSqlTemplate).not.toContain('"c_b"');

    // Conflict target is entity_record_id; SET excludes the PK.
    expect(stmt.insertSqlTemplate).toContain(
      `ON CONFLICT ("entity_record_id") DO UPDATE SET`
    );
    expect(stmt.insertSqlTemplate).not.toContain(
      `"entity_record_id" = EXCLUDED."entity_record_id"`
    );

    // Placeholder count = metadata cols (4) + live data cols (1) = 5 → $1..$5.
    expect(stmt.insertSqlTemplate).toContain("$1");
    expect(stmt.insertSqlTemplate).toContain("$5");
    expect(stmt.insertSqlTemplate).not.toContain("$6");

    // Sanity: liveRow id is the only column in the live set.
    expect(stmt.columns.map((c) => c.fieldMappingId)).toEqual([
      liveRow.fieldMappingId,
    ]);
  });

  // ── Smoke: empty entity (only metadata columns) ──────────────────

  it("works for an entity with zero data columns", async () => {
    const stmt = await cache.get(connectorEntityId, db);
    expect(stmt.columns).toHaveLength(0);
    expect(stmt.selectAllSql).toBe(
      `SELECT "entity_record_id", "organization_id", "synced_at", "is_valid" FROM "er__${connectorEntityId}"`
    );
    expect(stmt.insertSqlTemplate).toContain(
      `INSERT INTO "er__${connectorEntityId}" ("entity_record_id", "organization_id", "synced_at", "is_valid") VALUES ($1, $2, $3, $4)`
    );
  });
});
