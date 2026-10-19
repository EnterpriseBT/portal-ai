import {
  describe,
  it,
  expect,
  beforeAll,
  afterEach,
  afterAll,
} from "@jest/globals";
import { drizzle } from "drizzle-orm/postgres-js";
import { eq } from "drizzle-orm";
import postgres from "postgres";

import * as schema from "../../../db/schema/index.js";
import type { DbClient } from "../../../db/repositories/base.repository.js";
import { BulkTransformService } from "../../../services/bulk-transform.service.js";
import { wideTableReconcilerService } from "../../../services/wide-table-reconciler.service.js";
import { wideTableStatementCache } from "../../../services/wide-table-statement.cache.js";
import {
  generateId,
  seedUserAndOrg,
  teardownOrg,
} from "../utils/application.util.js";

// #641: records a bulk transform creates in a target entity carry the job's
// portal as provenance, and stay owned by the user the job acts as. This is
// the only live-SQL test of upsertSuccesses' insert; the queue suites mock it.

const {
  connectorDefinitions,
  connectorInstances,
  connectorEntities,
  columnDefinitions,
  fieldMappings,
  entityRecords,
} = schema;

const now = Date.now();
const audit = {
  created: now,
  createdBy: "SYSTEM_TEST",
  updated: null,
  updatedBy: null,
  deleted: null,
  deletedBy: null,
};

describe("bulk transform provenance (#641)", () => {
  let connection: ReturnType<typeof postgres>;
  let db: ReturnType<typeof drizzle>;

  beforeAll(() => {
    connection = postgres(process.env.DATABASE_URL as string, { max: 1 });
    db = drizzle(connection, { schema });
  });
  afterEach(async () => {
    await teardownOrg(db);
  });
  afterAll(async () => {
    await connection.end();
  });

  /** A target entity with one text column, `c_label`, on its wide table. */
  async function seedTarget() {
    const { userId, organizationId } = await seedUserAndOrg(
      db,
      "auth0|bulk-provenance"
    );
    const defId = generateId();
    await db.insert(connectorDefinitions).values({
      id: defId,
      slug: `slug-${defId}`,
      display: "Test Connector",
      category: "crm",
      authType: "oauth2",
      configSchema: null,
      capabilityFlags: { sync: true, read: true, write: true },
      isActive: true,
      version: "1.0.0",
      iconUrl: null,
      ...audit,
    } as never);
    const instId = generateId();
    await db.insert(connectorInstances).values({
      id: instId,
      connectorDefinitionId: defId,
      organizationId,
      name: "Test Instance",
      status: "active",
      config: null,
      credentials: null,
      lastSyncAt: null,
      lastErrorMessage: null,
      enabledCapabilityFlags: { read: true, write: true },
      ...audit,
    } as never);
    const entityId = generateId();
    await db.insert(connectorEntities).values({
      id: entityId,
      organizationId,
      connectorInstanceId: instId,
      key: `target_${generateId().replace(/-/g, "").slice(0, 8)}`,
      label: "Target",
      ...audit,
    } as never);
    const colId = generateId();
    await db.insert(columnDefinitions).values({
      id: colId,
      organizationId,
      key: `label_${generateId().replace(/-/g, "").slice(0, 8)}`,
      label: "Label",
      type: "string",
      description: null,
      validationPattern: null,
      validationMessage: null,
      canonicalFormat: null,
      ...audit,
    } as never);
    await db.insert(fieldMappings).values({
      id: generateId(),
      organizationId,
      connectorEntityId: entityId,
      columnDefinitionId: colId,
      sourceField: "label",
      isPrimaryKey: false,
      normalizedKey: "label",
      required: false,
      defaultValue: null,
      format: null,
      enumValues: null,
      ...audit,
    } as never);
    wideTableStatementCache.clear();
    await wideTableReconcilerService.reconcileEntity(
      entityId,
      db as unknown as DbClient
    );
    const stmt = await wideTableStatementCache.get(
      entityId,
      db as unknown as DbClient
    );
    const column = stmt.columns.find((c) => c.normalizedKey === "label")!;
    return { userId, organizationId, entityId, column: column.columnName };
  }

  const upsert = (
    t: Awaited<ReturnType<typeof seedTarget>>,
    sourcePortalId: string | null
  ) =>
    BulkTransformService.upsertSuccesses({
      targetConnectorEntityId: t.entityId,
      organizationId: t.organizationId,
      jobId: generateId(),
      successes: [{ sourceKey: "k-1", value: { [t.column]: "Acme" } }],
      userId: t.userId,
      sourcePortalId,
    });

  const created = async (entityId: string) => {
    const [row] = await db
      .select({
        createdBy: entityRecords.createdBy,
        origin: entityRecords.origin,
        sourcePortalId: entityRecords.sourcePortalId,
      })
      .from(entityRecords)
      .where(eq(entityRecords.connectorEntityId, entityId));
    return row;
  };

  it("an inserted record carries the job's portal, owned by the job's actor", async () => {
    const t = await seedTarget();
    await upsert(t, "portal-1");
    expect(await created(t.entityId)).toEqual({
      createdBy: t.userId,
      origin: "portal",
      sourcePortalId: "portal-1",
    });
  });

  it("a job with no portal inserts a record with none", async () => {
    const t = await seedTarget();
    await upsert(t, null);
    expect((await created(t.entityId))?.sourcePortalId).toBeNull();
  });
});
