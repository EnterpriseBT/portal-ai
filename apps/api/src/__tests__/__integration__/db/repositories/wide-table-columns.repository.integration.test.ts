/* eslint-disable @typescript-eslint/no-explicit-any -- escape hatches for drizzle ORM typings; values are validated upstream. */
/**
 * Integration tests for the WideTableColumnsRepository.
 *
 * Tests run against a real PostgreSQL database from the integration
 * test setup. Phase-1 metadata catalog only — no `er__*` runtime
 * tables are involved here; that's slice 4.
 */

import { describe, it, expect, beforeEach, afterEach } from "@jest/globals";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { eq } from "drizzle-orm";

import { WideTableColumnsRepository } from "../../../../db/repositories/wide-table-columns.repository.js";
import type { DbClient } from "../../../../db/repositories/base.repository.js";
import * as schema from "../../../../db/schema/index.js";
import type { WideTableColumnInsert } from "../../../../db/schema/zod.js";
import {
  generateId,
  teardownOrg,
  createUser,
  createOrganization,
} from "../../utils/application.util.js";

describe("WideTableColumnsRepository Integration Tests", () => {
  let connection!: ReturnType<typeof postgres>;
  let db!: DbClient;
  let repo: WideTableColumnsRepository;
  let orgId: string;
  let connectorEntityId: string;
  let connectorEntityId2: string;
  let fieldMappingId: string;
  let fieldMappingId2: string;
  let columnDefinitionId: string;

  beforeEach(async () => {
    if (!process.env.DATABASE_URL) {
      throw new Error("DATABASE_URL not set - setup.ts should have set this");
    }

    connection = postgres(process.env.DATABASE_URL, { max: 1 });
    db = drizzle(connection, { schema });
    repo = new WideTableColumnsRepository();

    await teardownOrg(db as ReturnType<typeof drizzle>);

    const now = Date.now();
    const dbTyped = db as ReturnType<typeof drizzle>;

    // user → org → connector def → instance → entity (×2) → column def → field-mapping (×2)
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
    connectorEntityId2 = generateId();
    await dbTyped.insert(schema.connectorEntities).values([
      {
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
      },
      {
        id: connectorEntityId2,
        organizationId: orgId,
        connectorInstanceId: instanceId,
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

    fieldMappingId = generateId();
    fieldMappingId2 = generateId();
    await dbTyped.insert(schema.fieldMappings).values([
      {
        id: fieldMappingId,
        organizationId: orgId,
        connectorEntityId,
        columnDefinitionId,
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
        id: fieldMappingId2,
        organizationId: orgId,
        connectorEntityId: connectorEntityId2,
        columnDefinitionId,
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
    ] as never);
  });

  afterEach(async () => {
    await connection.end();
  });

  // ── Helpers ──────────────────────────────────────────────────────

  function makeRow(
    overrides?: Partial<WideTableColumnInsert>
  ): WideTableColumnInsert {
    const now = Date.now();
    return {
      id: generateId(),
      organizationId: orgId,
      connectorEntityId,
      fieldMappingId,
      columnDefinitionId,
      columnName: "c_amount",
      pgType: "numeric",
      retiredAt: null,
      created: now,
      createdBy: "test-system",
      updated: null,
      updatedBy: null,
      deleted: null,
      deletedBy: null,
      ...overrides,
    } as WideTableColumnInsert;
  }

  // ── Case 1 — insert + read round-trip ────────────────────────────

  it("inserts a row and reads it back via findByConnectorEntityId", async () => {
    const row = makeRow();
    const created = await repo.create(row, db);
    expect(created.id).toBe(row.id);
    expect(created.columnName).toBe("c_amount");
    expect(created.pgType).toBe("numeric");

    const found = await repo.findByConnectorEntityId(connectorEntityId, {}, db);
    expect(found).toHaveLength(1);
    expect(found[0]!.id).toBe(row.id);
  });

  // ── Case 2 — unique on (connector_entity_id, column_name) live rows ──

  it("rejects duplicate (connectorEntityId, columnName) on live rows; allows on different entity", async () => {
    await repo.create(makeRow(), db);
    await expect(
      repo.create(
        makeRow({ id: generateId(), fieldMappingId: fieldMappingId2 }),
        db
      )
    ).rejects.toThrow();

    // Different entity: succeeds.
    const otherEntityRow = makeRow({
      id: generateId(),
      connectorEntityId: connectorEntityId2,
      fieldMappingId: fieldMappingId2,
    });
    const created = await repo.create(otherEntityRow, db);
    expect(created.connectorEntityId).toBe(connectorEntityId2);
  });

  // ── Case 3 — unique on (connector_entity_id, field_mapping_id) live rows ──

  it("rejects duplicate (connectorEntityId, fieldMappingId) on live rows", async () => {
    await repo.create(makeRow(), db);
    await expect(
      repo.create(makeRow({ id: generateId(), columnName: "c_amount_2" }), db)
    ).rejects.toThrow();
  });

  // ── Case 4 — soft-delete frees both unique constraints ───────────

  it("allows reuse of (entity, columnName) and (entity, fieldMappingId) after soft-delete", async () => {
    const first = await repo.create(makeRow(), db);
    await repo.softDelete(first.id, "test-system", db);

    // New row with both same column_name AND same field_mapping_id — succeeds.
    const second = await repo.create(makeRow({ id: generateId() }), db);
    expect(second.id).not.toBe(first.id);
    expect(second.columnName).toBe(first.columnName);
    expect(second.fieldMappingId).toBe(first.fieldMappingId);
  });

  // ── Case 5 — retired_at independent of deleted ───────────────────

  it("retiredAt does not affect uniqueness; row remains in includeRetired query", async () => {
    const row = await repo.create(makeRow(), db);
    const retired = await repo.markRetired(
      row.id,
      Date.now(),
      "test-system",
      db
    );
    expect(retired?.retiredAt).toBeGreaterThan(0);

    // Default findByConnectorEntityId hides retired rows.
    const live = await repo.findByConnectorEntityId(connectorEntityId, {}, db);
    expect(live).toHaveLength(0);

    // includeRetired returns it.
    const all = await repo.findByConnectorEntityId(
      connectorEntityId,
      { includeRetired: true },
      db
    );
    expect(all).toHaveLength(1);
    expect(all[0]!.id).toBe(row.id);

    // findRetiredByConnectorEntityId returns it specifically.
    const retiredRows =
      await repo.findRetiredByConnectorEntityId(connectorEntityId, db);
    expect(retiredRows).toHaveLength(1);

    // Inserting a new row with the same column_name still fails because
    // the partial unique index ignores retired_at — the previous row is
    // still alive (deleted IS NULL) on disk.
    await expect(
      repo.create(makeRow({ id: generateId() }), db)
    ).rejects.toThrow();
  });

  // ── Case 6 — migration apply (forward) ───────────────────────────

  it("table exists after global setup migration", async () => {
    // The integration setup runs all migrations in beforeAll. If 0052 ran,
    // the wide_table_columns table exists in information_schema.
    const result = await db.execute<{ table_name: string }>(
      `SELECT table_name FROM information_schema.tables WHERE table_name = 'wide_table_columns'` as any
    );
    const rows = (result as unknown as { table_name: string }[]) ?? [];
    expect(rows.length).toBeGreaterThan(0);
  });

  // ── Case 7 — migration columns + indexes present ─────────────────

  it("required columns and indexes are present after migration", async () => {
    const colsResult = await db.execute<{ column_name: string }>(
      `SELECT column_name FROM information_schema.columns WHERE table_name = 'wide_table_columns'` as any
    );
    const cols = ((colsResult as unknown) as { column_name: string }[]) ?? [];
    const colNames = new Set(cols.map((c) => c.column_name));
    for (const expected of [
      "id",
      "created",
      "created_by",
      "updated",
      "updated_by",
      "deleted",
      "deleted_by",
      "organization_id",
      "connector_entity_id",
      "field_mapping_id",
      "column_definition_id",
      "column_name",
      "pg_type",
      "retired_at",
    ]) {
      expect(colNames.has(expected)).toBe(true);
    }

    const idxResult = await db.execute<{ indexname: string }>(
      `SELECT indexname FROM pg_indexes WHERE tablename = 'wide_table_columns'` as any
    );
    const idxs =
      ((idxResult as unknown) as { indexname: string }[]) ?? [];
    const idxNames = new Set(idxs.map((i) => i.indexname));
    expect(idxNames.has("wide_table_columns_entity_column_unique")).toBe(true);
    expect(idxNames.has("wide_table_columns_entity_field_mapping_unique")).toBe(
      true
    );
    expect(idxNames.has("wide_table_columns_entity_idx")).toBe(true);
  });

  // ── Smoke: filter scope respected by findByConnectorEntityId ─────

  it("findByConnectorEntityId scopes by entity id", async () => {
    await repo.create(makeRow(), db);
    await repo.create(
      makeRow({
        id: generateId(),
        connectorEntityId: connectorEntityId2,
        fieldMappingId: fieldMappingId2,
      }),
      db
    );

    const e1 = await repo.findByConnectorEntityId(connectorEntityId, {}, db);
    const e2 = await repo.findByConnectorEntityId(connectorEntityId2, {}, db);
    expect(e1).toHaveLength(1);
    expect(e2).toHaveLength(1);
    expect(e1[0]!.connectorEntityId).toBe(connectorEntityId);
    expect(e2[0]!.connectorEntityId).toBe(connectorEntityId2);

    // Sanity check that direct table query matches.
    const direct = await db
      .select()
      .from(schema.wideTableColumns)
      .where(eq(schema.wideTableColumns.connectorEntityId, connectorEntityId));
    expect(direct).toHaveLength(1);
  });
});
