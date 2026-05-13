/**
 * Integration test for `AnalyticsService.resolveIdentity` against the
 * phase-2 wide tables (Phase 3 slice 3).
 *
 * Two connector entities (`customers`, `orders`) are reconciled. Each
 * has a `c_customer_id` field-mapping that serves as the link column.
 * Rows are seeded on both wide tables; `resolveIdentity` is called for
 * a known link value and asserted to return the matched rows grouped
 * by entity, primary first.
 */

import {
  describe,
  it,
  expect,
  beforeEach,
  afterEach,
} from "@jest/globals";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { sql } from "drizzle-orm";

import { WideTableReconcilerService } from "../../../services/wide-table-reconciler.service.js";
import {
  WideTableStatementCache,
  wideTableStatementCache as singletonStatementCache,
} from "../../../services/wide-table-statement.cache.js";
import { AnalyticsService } from "../../../services/analytics.service.js";
import * as schema from "../../../db/schema/index.js";
import type { DbClient } from "../../../db/repositories/base.repository.js";
import type { EntityGroupContext } from "../../../services/analytics.service.js";
import {
  generateId,
  teardownOrg,
  createUser,
  createOrganization,
} from "../utils/application.util.js";

describe("AnalyticsService.resolveIdentity (Postgres-direct)", () => {
  let connection!: ReturnType<typeof postgres>;
  let db!: DbClient;
  let statementCache: WideTableStatementCache;
  let reconciler: WideTableReconcilerService;
  let orgId: string;
  let customersEntityId: string;
  let ordersEntityId: string;

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
    singletonStatementCache.clear();

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
      capabilityFlags: { read: true, write: true, sync: true },
      isActive: true,
      version: "1.0.0",
      iconUrl: null,
      created: now,
      createdBy: "SYSTEM_TEST",
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
      enabledCapabilityFlags: { read: true, write: true, sync: true },
      created: now,
      createdBy: "SYSTEM_TEST",
      updated: null,
      updatedBy: null,
      deleted: null,
      deletedBy: null,
    } as never);

    customersEntityId = generateId();
    ordersEntityId = generateId();
    await dbTyped.insert(schema.connectorEntities).values([
      {
        id: customersEntityId,
        organizationId: orgId,
        connectorInstanceId,
        key: "customers",
        label: "Customers",
        created: now,
        createdBy: "SYSTEM_TEST",
        updated: null,
        updatedBy: null,
        deleted: null,
        deletedBy: null,
      },
      {
        id: ordersEntityId,
        organizationId: orgId,
        connectorInstanceId,
        key: "orders",
        label: "Orders",
        created: now,
        createdBy: "SYSTEM_TEST",
        updated: null,
        updatedBy: null,
        deleted: null,
        deletedBy: null,
      },
    ] as never);

    const cdCustomerId = generateId();
    const cdName = generateId();
    const cdAmount = generateId();
    await dbTyped.insert(schema.columnDefinitions).values([
      mkColumnDef(cdCustomerId, orgId, "customer_id", "Customer ID", "string", now),
      mkColumnDef(cdName, orgId, "name", "Name", "string", now),
      mkColumnDef(cdAmount, orgId, "amount", "Amount", "number", now),
    ] as never);

    await dbTyped.insert(schema.fieldMappings).values([
      mkMapping(
        orgId,
        customersEntityId,
        cdCustomerId,
        "Customer ID",
        "customer_id",
        now
      ),
      mkMapping(orgId, customersEntityId, cdName, "Name", "name", now + 1),
      mkMapping(
        orgId,
        ordersEntityId,
        cdCustomerId,
        "Customer ID",
        "customer_id",
        now
      ),
      mkMapping(orgId, ordersEntityId, cdAmount, "Amount", "amount", now + 1),
    ] as never);

    await reconciler.reconcileEntity(customersEntityId, db);
    await reconciler.reconcileEntity(ordersEntityId, db);
  });

  afterEach(async () => {
    try {
      await reconciler.dropTable(customersEntityId, db);
    } catch {
      /* ignore */
    }
    try {
      await reconciler.dropTable(ordersEntityId, db);
    } catch {
      /* ignore */
    }
    statementCache.clear();
    singletonStatementCache.clear();
    await connection.end();
  });

  async function seedRow(
    entityId: string,
    sourceId: string,
    extras: Record<string, unknown>
  ): Promise<string> {
    const id = generateId();
    const now = Date.now();
    const dbTyped = db as ReturnType<typeof drizzle>;
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
      checksum: `c-${id}`,
      origin: "sync",
      created: now,
      createdBy: "SYSTEM_TEST",
      updated: null,
      updatedBy: null,
      deleted: null,
      deletedBy: null,
    } as never);
    const keys = ["entity_record_id", "organization_id", "synced_at", "is_valid", "source_id", ...Object.keys(extras)];
    const values: unknown[] = [id, orgId, now, true, sourceId, ...Object.values(extras)];
    const colList = keys.map((k) => `"${k}"`).join(", ");
    const placeholders = values.map((_, i) => `$${i + 1}`).join(", ");
    await connection.unsafe(
      `INSERT INTO "er__${entityId}" (${colList}) VALUES (${placeholders})`,
      values as never
    );
    return id;
  }

  function buildEntityGroup(): EntityGroupContext[] {
    return [
      {
        id: "eg-1",
        name: "Customer Orders",
        members: [
          {
            entityKey: "customers",
            connectorEntityId: customersEntityId,
            linkNormalizedKey: "customer_id",
            linkColumnKey: "customer_id",
            linkColumnLabel: "Customer ID",
            isPrimary: true,
          },
          {
            entityKey: "orders",
            connectorEntityId: ordersEntityId,
            linkNormalizedKey: "customer_id",
            linkColumnKey: "customer_id",
            linkColumnLabel: "Customer ID",
            isPrimary: false,
          },
        ],
      },
    ];
  }

  it("returns matched rows grouped by entity, primary first", async () => {
    await seedRow(customersEntityId, "cust-1", {
      c_customer_id: "C001",
      c_name: "Alice",
    });
    await seedRow(customersEntityId, "cust-2", {
      c_customer_id: "C002",
      c_name: "Bob",
    });
    await seedRow(ordersEntityId, "ord-1", {
      c_customer_id: "C001",
      c_amount: 100,
    });
    await seedRow(ordersEntityId, "ord-2", {
      c_customer_id: "C001",
      c_amount: 50,
    });
    await seedRow(ordersEntityId, "ord-3", {
      c_customer_id: "C002",
      c_amount: 75,
    });

    const result = await AnalyticsService.resolveIdentity({
      entityGroupName: "Customer Orders",
      linkValue: "C001",
      organizationId: orgId,
      entityGroups: buildEntityGroup(),
    });

    expect(result.matches).toHaveLength(2);
    expect(result.matches[0].entityKey).toBe("customers");
    expect(result.matches[0].isPrimary).toBe(true);
    expect(result.matches[0].records).toHaveLength(1);
    expect(result.matches[0].records[0]).toMatchObject({
      customer_id: "C001",
      name: "Alice",
    });

    expect(result.matches[1].entityKey).toBe("orders");
    expect(result.matches[1].isPrimary).toBe(false);
    expect(result.matches[1].records).toHaveLength(2);
  });

  it("returns empty matches for an unknown link value", async () => {
    await seedRow(customersEntityId, "cust-1", {
      c_customer_id: "C001",
      c_name: "Alice",
    });

    const result = await AnalyticsService.resolveIdentity({
      entityGroupName: "Customer Orders",
      linkValue: "Z999",
      organizationId: orgId,
      entityGroups: buildEntityGroup(),
    });
    expect(result.matches.every((m) => m.records.length === 0)).toBe(true);
  });

  it("throws for an unknown entity-group name", async () => {
    await expect(
      AnalyticsService.resolveIdentity({
        entityGroupName: "Nope",
        linkValue: "C001",
        organizationId: orgId,
        entityGroups: buildEntityGroup(),
      })
    ).rejects.toThrow(/not found/);
  });
});

function mkColumnDef(
  id: string,
  orgId: string,
  key: string,
  label: string,
  type: string,
  now: number
): Record<string, unknown> {
  return {
    id,
    organizationId: orgId,
    key,
    label,
    type,
    description: null,
    validationPattern: null,
    validationMessage: null,
    canonicalFormat: null,
    system: false,
    created: now,
    createdBy: "SYSTEM_TEST",
    updated: null,
    updatedBy: null,
    deleted: null,
    deletedBy: null,
  };
}

function mkMapping(
  orgId: string,
  entityId: string,
  columnDefinitionId: string,
  sourceField: string,
  normalizedKey: string,
  created: number
): Record<string, unknown> {
  return {
    id: generateId(),
    organizationId: orgId,
    connectorEntityId: entityId,
    columnDefinitionId,
    sourceField,
    isPrimaryKey: false,
    normalizedKey,
    required: false,
    defaultValue: null,
    format: null,
    enumValues: null,
    refNormalizedKey: null,
    refEntityKey: null,
    created,
    createdBy: "SYSTEM_TEST",
    updated: null,
    updatedBy: null,
    deleted: null,
    deletedBy: null,
  };
}

// Avoid unused-symbol gripe — sql import is here for fidelity with sibling
// integration files, where the helper is reused for ad-hoc probes.
void sql;
