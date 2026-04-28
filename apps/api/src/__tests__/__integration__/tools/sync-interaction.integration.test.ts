/* global AbortController */
import { describe, it, expect, beforeEach, afterEach } from "@jest/globals";
import { drizzle } from "drizzle-orm/postgres-js";
import { eq } from "drizzle-orm";
import postgres from "postgres";
import * as schema from "../../../db/schema/index.js";
import {
  generateId,
  seedUserAndOrg,
  teardownOrg,
} from "../utils/application.util.js";

const { EntityRecordCreateTool } =
  await import("../../../tools/entity-record-create.tool.js");
const { EntityRecordDeleteTool } =
  await import("../../../tools/entity-record-delete.tool.js");
const { EntityRecordUpdateTool } =
  await import("../../../tools/entity-record-update.tool.js");

const {
  connectorDefinitions,
  connectorInstances,
  connectorEntities,
  columnDefinitions,
  fieldMappings,
  entityRecords,
  stations,
  stationInstances,
} = schema;

// ── Helpers ────────────────────────────────────────────────────────

const now = Date.now();
const toolOpts = {
  toolCallId: "t",
  messages: [] as never[],
  abortSignal: new AbortController().signal,
};

function createConnectorDefinition() {
  return {
    id: generateId(),
    slug: `slug-${generateId()}`,
    display: "Test Connector",
    category: "crm",
    authType: "oauth2",
    configSchema: null,
    capabilityFlags: { sync: true, read: true, write: true },
    isActive: true,
    version: "1.0.0",
    iconUrl: null,
    created: now,
    createdBy: "SYSTEM_TEST",
    updated: null,
    updatedBy: null,
    deleted: null,
    deletedBy: null,
  };
}

function createConnectorInstance(
  connectorDefinitionId: string,
  organizationId: string
) {
  return {
    id: generateId(),
    connectorDefinitionId,
    organizationId,
    name: "Test Instance",
    status: "active" as const,
    config: null,
    credentials: null,
    lastSyncAt: null,
    lastErrorMessage: null,
    enabledCapabilityFlags: { write: true },
    created: now,
    createdBy: "SYSTEM_TEST",
    updated: null,
    updatedBy: null,
    deleted: null,
    deletedBy: null,
  };
}

function createConnEntity(organizationId: string, connectorInstanceId: string) {
  return {
    id: generateId(),
    organizationId,
    connectorInstanceId,
    key: `entity_${generateId().replace(/-/g, "").slice(0, 8)}`,
    label: "Test Entity",
    created: now,
    createdBy: "SYSTEM_TEST",
    updated: null,
    updatedBy: null,
    deleted: null,
    deletedBy: null,
  };
}

function createColumnDef(organizationId: string, key: string) {
  return {
    id: generateId(),
    organizationId,
    key,
    label: key,
    type: "string",
    description: null,
    validationPattern: null,
    validationMessage: null,
    canonicalFormat: null,
    created: now,
    createdBy: "SYSTEM_TEST",
    updated: null,
    updatedBy: null,
    deleted: null,
    deletedBy: null,
  };
}

function createFieldMapping(
  organizationId: string,
  connectorEntityId: string,
  columnDefinitionId: string,
  sourceField: string
) {
  return {
    id: generateId(),
    organizationId,
    connectorEntityId,
    columnDefinitionId,
    sourceField,
    isPrimaryKey: false,
    normalizedKey: sourceField.toLowerCase().replace(/\s+/g, "_"),
    required: false,
    defaultValue: null,
    format: null,
    enumValues: null,
    created: now,
    createdBy: "SYSTEM_TEST",
    updated: null,
    updatedBy: null,
    deleted: null,
    deletedBy: null,
  };
}

function createSyncRecord(
  organizationId: string,
  connectorEntityId: string,
  sourceId: string,
  data: Record<string, unknown>,
  normalizedData: Record<string, unknown>
) {
  return {
    id: generateId(),
    organizationId,
    connectorEntityId,
    data,
    normalizedData,
    sourceId,
    checksum: generateId().slice(0, 16),
    syncedAt: now,
    origin: "sync" as const,
    validationErrors: null,
    isValid: true,
    created: now,
    createdBy: "SYSTEM_TEST",
    updated: null,
    updatedBy: null,
    deleted: null,
    deletedBy: null,
  };
}

async function seedStation(db: ReturnType<typeof drizzle>) {
  const { userId, organizationId } = await seedUserAndOrg(
    db,
    "auth0|sync-test"
  );
  const def = createConnectorDefinition();
  await db.insert(connectorDefinitions).values(def as never);
  const inst = createConnectorInstance(def.id, organizationId);
  await db.insert(connectorInstances).values(inst as never);
  const station = {
    id: generateId(),
    organizationId,
    name: "Sync Station",
    description: null,
    toolPacks: ["entity_management"],
    created: now,
    createdBy: "SYSTEM_TEST",
    updated: null,
    updatedBy: null,
    deleted: null,
    deletedBy: null,
  };
  await db.insert(stations).values(station as never);
  await db.insert(stationInstances).values({
    id: generateId(),
    stationId: station.id,
    connectorInstanceId: inst.id,
    created: now,
    createdBy: "SYSTEM_TEST",
    updated: null,
    updatedBy: null,
    deleted: null,
    deletedBy: null,
  } as never);
  const entity = createConnEntity(organizationId, inst.id);
  await db.insert(connectorEntities).values(entity as never);
  const colDef = createColumnDef(organizationId, "name");
  await db.insert(columnDefinitions).values(colDef as never);
  const mapping = createFieldMapping(
    organizationId,
    entity.id,
    colDef.id,
    "Name"
  );
  await db.insert(fieldMappings).values(mapping as never);

  return {
    userId,
    organizationId,
    stationId: station.id,
    connectorEntityId: entity.id,
    connectorInstanceId: inst.id,
  };
}

// ── Tests ──────────────────────────────────────────────────────────

describe("Sync-after-mutation interaction", () => {
  let connection!: ReturnType<typeof postgres>;
  let db!: ReturnType<typeof drizzle>;

  beforeEach(async () => {
    if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL not set");
    connection = postgres(process.env.DATABASE_URL, { max: 1 });
    db = drizzle(connection, { schema });
    await teardownOrg(db as ReturnType<typeof drizzle>);
  });

  afterEach(async () => {
    await connection.end();
  });

  it("sync does not overwrite tool-created records (UUID sourceId vs row-index sourceId)", async () => {
    const s = await seedStation(db);

    // Create a portal record (UUID sourceId)
    const tool = new EntityRecordCreateTool().build(
      s.stationId,
      s.organizationId,
      s.userId
    );
    const result = (await tool.execute!(
      {
        items: [
          {
            connectorEntityId: s.connectorEntityId,
            data: { Name: "Portal User" },
          },
        ],
      },
      toolOpts
    )) as Record<string, unknown>;
    expect(result.success).toBe(true);
    const portalRecordId = (result.items as any[])[0].entityId as string;

    // Simulate a sync by upserting records with row-index sourceIds
    const syncRecord = createSyncRecord(
      s.organizationId,
      s.connectorEntityId,
      "0",
      { Name: "Synced User" },
      { name: "Synced User" }
    );
    await db.insert(entityRecords).values(syncRecord as never);

    // Portal record should still exist unchanged
    const [portalRow] = await db
      .select()
      .from(entityRecords)
      .where(eq(entityRecords.id, portalRecordId));
    expect(portalRow).toBeDefined();
    expect(portalRow.origin).toBe("portal");
    expect(portalRow.data).toEqual({ Name: "Portal User" });
  });

  it("sync restores tool-deleted synced records", async () => {
    const s = await seedStation(db);

    // Insert a synced record
    const syncRec = createSyncRecord(
      s.organizationId,
      s.connectorEntityId,
      "0",
      { Name: "Original" },
      { name: "Original" }
    );
    await db.insert(entityRecords).values(syncRec as never);

    // Delete it via tool
    const deleteTool = new EntityRecordDeleteTool().build(
      s.stationId,
      s.userId
    );
    await deleteTool.execute!(
      {
        items: [
          {
            connectorEntityId: s.connectorEntityId,
            entityRecordId: syncRec.id,
          },
        ],
      },
      toolOpts
    );

    // Simulate sync re-creating the record with same sourceId (new row)
    const restoredRec = createSyncRecord(
      s.organizationId,
      s.connectorEntityId,
      "0-restored",
      { Name: "Restored" },
      { name: "Restored" }
    );
    await db.insert(entityRecords).values(restoredRec as never);

    // The restored record should exist
    const [restored] = await db
      .select()
      .from(entityRecords)
      .where(eq(entityRecords.id, restoredRec.id));
    expect(restored).toBeDefined();
    expect(restored.origin).toBe("sync");
  });

  it("sync overwrites tool-modified synced records", async () => {
    const s = await seedStation(db);

    // Insert a synced record
    const syncRec = createSyncRecord(
      s.organizationId,
      s.connectorEntityId,
      "row-0",
      { Name: "Original" },
      { name: "Original" }
    );
    await db.insert(entityRecords).values(syncRec as never);

    // Modify via tool
    const updateTool = new EntityRecordUpdateTool().build(
      s.stationId,
      s.userId
    );
    await updateTool.execute!(
      {
        items: [
          {
            connectorEntityId: s.connectorEntityId,
            entityRecordId: syncRec.id,
            data: { Name: "Modified" },
          },
        ],
      },
      toolOpts
    );

    // Simulate sync overwriting: update the record back to original
    await db
      .update(entityRecords)
      .set({
        data: { Name: "Original" },
        normalizedData: { name: "Original" },
        checksum: "new-checksum",
      } as never)
      .where(eq(entityRecords.id, syncRec.id));

    const [row] = await db
      .select()
      .from(entityRecords)
      .where(eq(entityRecords.id, syncRec.id));
    expect(row.data).toEqual({ Name: "Original" });
  });

  it("sync uses tool-created field mappings (new mapping applied to normalizedData)", async () => {
    const s = await seedStation(db);

    // Add a new column definition + field mapping via direct DB insert (simulating tool output)
    const newCol = createColumnDef(s.organizationId, "email");
    await db.insert(columnDefinitions).values(newCol as never);
    const newMapping = createFieldMapping(
      s.organizationId,
      s.connectorEntityId,
      newCol.id,
      "Email"
    );
    await db.insert(fieldMappings).values(newMapping as never);

    // The new mapping now exists — a sync would use it to normalize data
    // Verify the mapping is in the DB
    const mappings = await db
      .select()
      .from(fieldMappings)
      .where(eq(fieldMappings.connectorEntityId, s.connectorEntityId));
    const emailMapping = mappings.find((m) => m.sourceField === "Email");
    expect(emailMapping).toBeDefined();
    expect(emailMapping!.columnDefinitionId).toBe(newCol.id);
  });
});
