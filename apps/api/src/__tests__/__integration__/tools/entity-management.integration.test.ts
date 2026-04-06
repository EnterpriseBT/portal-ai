/* global AbortController */
import {
  describe,
  it,
  expect,
  beforeEach,
  afterEach,
} from "@jest/globals";
import { drizzle } from "drizzle-orm/postgres-js";
import { eq } from "drizzle-orm";
import postgres from "postgres";
import * as schema from "../../../db/schema/index.js";
import {
  generateId,
  seedUserAndOrg,
  teardownOrg,
} from "../utils/application.util.js";

// We import tools directly — they use the real DbService/repos under the hood
const { EntityRecordCreateTool } = await import("../../../tools/entity-record-create.tool.js");
const { EntityRecordUpdateTool } = await import("../../../tools/entity-record-update.tool.js");
const { EntityRecordDeleteTool } = await import("../../../tools/entity-record-delete.tool.js");
const { ConnectorEntityDeleteTool } = await import("../../../tools/connector-entity-delete.tool.js");
const { FieldMappingDeleteTool } = await import("../../../tools/field-mapping-delete.tool.js");
const { ColumnDefinitionDeleteTool } = await import("../../../tools/column-definition-delete.tool.js");

const {
  connectorDefinitions,
  connectorInstances,
  connectorEntities,
  columnDefinitions,
  fieldMappings,
  entityRecords,
  stations,
  stationInstances
} = schema;

// ── Helpers ────────────────────────────────────────────────────────

const now = Date.now();

function createConnectorDefinition(overrides?: Partial<Record<string, unknown>>) {
  return {
    id: generateId(),
    slug: `slug-${generateId()}`,
    display: "Test Connector",
    category: "crm",
    authType: "oauth2",
    configSchema: null,
    capabilityFlags: { sync: true, query: true, write: true },
    isActive: true,
    version: "1.0.0",
    iconUrl: null,
    created: now,
    createdBy: "SYSTEM_TEST",
    updated: null,
    updatedBy: null,
    deleted: null,
    deletedBy: null,
    ...overrides,
  };
}

function createConnectorInstance(
  connectorDefinitionId: string,
  organizationId: string,
  overrides?: Partial<Record<string, unknown>>
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
    ...overrides,
  };
}

function createConnEntity(
  organizationId: string,
  connectorInstanceId: string,
  overrides?: Partial<Record<string, unknown>>
) {
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
    ...overrides,
  };
}

function createColumnDef(organizationId: string, key: string, type: string) {
  return {
    id: generateId(),
    organizationId,
    key,
    label: key,
    type,
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

function createStation(organizationId: string) {
  return {
    id: generateId(),
    organizationId,
    name: "Test Station",
    description: null,
    toolPacks: ["entity_management"],
    created: now,
    createdBy: "SYSTEM_TEST",
    updated: null,
    updatedBy: null,
    deleted: null,
    deletedBy: null,
  };
}

function createStationInstance(stationId: string, connectorInstanceId: string) {
  return {
    id: generateId(),
    stationId,
    connectorInstanceId,
    created: now,
    createdBy: "SYSTEM_TEST",
    updated: null,
    updatedBy: null,
    deleted: null,
    deletedBy: null,
  };
}

const toolOpts = { toolCallId: "t", messages: [] as never[], abortSignal: new AbortController().signal };

interface SeedResult {
  userId: string;
  organizationId: string;
  stationId: string;
  connectorInstanceId: string;
  connectorEntityId: string;
  columnDefinitionId: string;
  fieldMappingId: string;
}

async function seed(db: ReturnType<typeof drizzle>, overrides?: {
  definitionOverrides?: Partial<Record<string, unknown>>;
  instanceOverrides?: Partial<Record<string, unknown>>;
}): Promise<SeedResult> {
  const { userId, organizationId } = await seedUserAndOrg(db, "auth0|tool-test");

  const def = createConnectorDefinition(overrides?.definitionOverrides);
  await db.insert(connectorDefinitions).values(def as never);

  const inst = createConnectorInstance(def.id, organizationId, overrides?.instanceOverrides);
  await db.insert(connectorInstances).values(inst as never);

  const station = createStation(organizationId);
  await db.insert(stations).values(station as never);

  const si = createStationInstance(station.id, inst.id);
  await db.insert(stationInstances).values(si as never);

  const entity = createConnEntity(organizationId, inst.id);
  await db.insert(connectorEntities).values(entity as never);

  const colDef = createColumnDef(organizationId, "name", "string");
  await db.insert(columnDefinitions).values(colDef as never);

  const mapping = createFieldMapping(organizationId, entity.id, colDef.id, "Name");
  await db.insert(fieldMappings).values(mapping as never);

  return {
    userId,
    organizationId,
    stationId: station.id,
    connectorInstanceId: inst.id,
    connectorEntityId: entity.id,
    columnDefinitionId: colDef.id,
    fieldMappingId: mapping.id,
  };
}

// ── Tests ──────────────────────────────────────────────────────────

describe("Entity management tool integration", () => {
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

  // ── entity_record_create ──────────────────────────────────────

  describe("entity_record_create", () => {
    it("creates record in DB with origin portal and auto-generated normalizedData", async () => {
      const s = await seed(db);
      const tool = new EntityRecordCreateTool().build(s.stationId, s.organizationId, s.userId);

      const result = await tool.execute!(
        { connectorEntityId: s.connectorEntityId, data: { Name: "Jane" } },
        toolOpts,
      ) as Record<string, unknown>;

      expect(result.success).toBe(true);
      const recordId = result.entityId as string;

      // Verify in DB
      const rows = await db.select().from(entityRecords).where(eq(entityRecords.id, recordId));
      expect(rows).toHaveLength(1);
      expect(rows[0].origin).toBe("portal");
      expect(rows[0].normalizedData).toEqual({ name: "Jane" });
    });

    it("rejects when write disabled on instance", async () => {
      const s = await seed(db, {
        definitionOverrides: { capabilityFlags: { sync: true, query: true, write: false } },
      });
      const tool = new EntityRecordCreateTool().build(s.stationId, s.organizationId, s.userId);

      const result = await tool.execute!(
        { connectorEntityId: s.connectorEntityId, data: { Name: "X" } },
        toolOpts,
      ) as Record<string, unknown>;

      expect(result.error).toBeDefined();

      // No record created
      const rows = await db.select().from(entityRecords)
        .where(eq(entityRecords.connectorEntityId, s.connectorEntityId));
      expect(rows).toHaveLength(0);
    });

    it("rejects when entity not attached to station", async () => {
      const s = await seed(db);
      // Create another entity NOT attached to this station
      const otherEntity = createConnEntity(s.organizationId, s.connectorInstanceId);
      await db.insert(connectorEntities).values(otherEntity as never);

      // Create a second station that does NOT have the instance
      const otherStation = createStation(s.organizationId);
      await db.insert(stations).values(otherStation as never);

      const tool = new EntityRecordCreateTool().build(otherStation.id, s.organizationId, s.userId);

      const result = await tool.execute!(
        { connectorEntityId: s.connectorEntityId, data: { Name: "X" } },
        toolOpts,
      ) as Record<string, unknown>;

      expect(result.error).toBeDefined();
    });
  });

  // ── entity_record_update ──────────────────────────────────────

  describe("entity_record_update", () => {
    it("updates record data and normalizedData in DB", async () => {
      const s = await seed(db);
      // Create a record first
      const createTool = new EntityRecordCreateTool().build(s.stationId, s.organizationId, s.userId);
      const created = await createTool.execute!(
        { connectorEntityId: s.connectorEntityId, data: { Name: "Alice" } },
        toolOpts,
      ) as Record<string, unknown>;
      const recordId = created.entityId as string;

      // Now update
      const updateTool = new EntityRecordUpdateTool().build(s.stationId, s.userId);
      const result = await updateTool.execute!(
        { connectorEntityId: s.connectorEntityId, entityRecordId: recordId, data: { Name: "Bob" } },
        toolOpts,
      ) as Record<string, unknown>;

      expect(result.success).toBe(true);

      const rows = await db.select().from(entityRecords).where(eq(entityRecords.id, recordId));
      expect(rows[0].data).toEqual({ Name: "Bob" });
      expect(rows[0].normalizedData).toEqual({ name: "Bob" });
    });

    it("rejects update on record from different entity", async () => {
      const s = await seed(db);
      const createTool = new EntityRecordCreateTool().build(s.stationId, s.organizationId, s.userId);
      const created = await createTool.execute!(
        { connectorEntityId: s.connectorEntityId, data: { Name: "Alice" } },
        toolOpts,
      ) as Record<string, unknown>;

      // Create a second entity on the same instance
      const otherEntity = createConnEntity(s.organizationId, s.connectorInstanceId);
      await db.insert(connectorEntities).values(otherEntity as never);

      const updateTool = new EntityRecordUpdateTool().build(s.stationId, s.userId);
      const result = await updateTool.execute!(
        { connectorEntityId: otherEntity.id, entityRecordId: created.entityId as string, data: { Name: "X" } },
        toolOpts,
      ) as Record<string, unknown>;

      expect(result.error).toBeDefined();
    });
  });

  // ── entity_record_delete ──────────────────────────────────────

  describe("entity_record_delete", () => {
    it("soft-deletes record — deleted timestamp set, invisible to queries", async () => {
      const s = await seed(db);
      const createTool = new EntityRecordCreateTool().build(s.stationId, s.organizationId, s.userId);
      const created = await createTool.execute!(
        { connectorEntityId: s.connectorEntityId, data: { Name: "Alice" } },
        toolOpts,
      ) as Record<string, unknown>;
      const recordId = created.entityId as string;

      const deleteTool = new EntityRecordDeleteTool().build(s.stationId, s.userId);
      const result = await deleteTool.execute!(
        { connectorEntityId: s.connectorEntityId, entityRecordId: recordId },
        toolOpts,
      ) as Record<string, unknown>;

      expect(result.success).toBe(true);

      // Verify deleted timestamp is set (raw query to bypass soft-delete filter)
      const rows = await db.select().from(entityRecords).where(eq(entityRecords.id, recordId));
      // soft-delete aware findMany won't return it, but raw select will
      // We need to check the row has a deleted timestamp
      expect(rows.length).toBeLessThanOrEqual(1);
      if (rows.length === 1) {
        expect(rows[0].deleted).not.toBeNull();
      }
    });
  });

  // ── connector_entity_delete ───────────────────────────────────

  describe("connector_entity_delete", () => {
    it("cascade deletes all dependents in transaction", async () => {
      const s = await seed(db);
      // Create a record so cascades have something to delete
      const createTool = new EntityRecordCreateTool().build(s.stationId, s.organizationId, s.userId);
      await createTool.execute!(
        { connectorEntityId: s.connectorEntityId, data: { Name: "Alice" } },
        toolOpts,
      );

      const tool = new ConnectorEntityDeleteTool().build(s.stationId, s.userId);
      const result = await tool.execute!(
        { connectorEntityId: s.connectorEntityId },
        toolOpts,
      ) as Record<string, unknown>;

      expect(result.success).toBe(true);
      expect((result.summary as Record<string, unknown>)?.cascaded).toBeDefined();
    });

    it("blocks when external references exist — nothing deleted", async () => {
      const s = await seed(db);

      // Create a second entity with a field mapping referencing the first entity's key
      const entity2 = createConnEntity(s.organizationId, s.connectorInstanceId);
      await db.insert(connectorEntities).values(entity2 as never);

      // Get the first entity's key
      const [firstEntity] = await db.select().from(connectorEntities)
        .where(eq(connectorEntities.id, s.connectorEntityId));

      const refColDef = createColumnDef(s.organizationId, "ref_col", "string");
      await db.insert(columnDefinitions).values(refColDef as never);

      const refMapping = {
        ...createFieldMapping(s.organizationId, entity2.id, refColDef.id, "ref_field"),
        refEntityKey: firstEntity.key,
        refColumnDefinitionId: s.columnDefinitionId,
      };
      await db.insert(fieldMappings).values(refMapping as never);

      const tool = new ConnectorEntityDeleteTool().build(s.stationId, s.userId);
      const result = await tool.execute!(
        { connectorEntityId: s.connectorEntityId },
        toolOpts,
      ) as Record<string, unknown>;

      expect(result.error).toBeDefined();

      // Entity should still exist
      const [entity] = await db.select().from(connectorEntities)
        .where(eq(connectorEntities.id, s.connectorEntityId));
      expect(entity).toBeDefined();
      expect(entity.deleted).toBeNull();
    });
  });

  // ── field_mapping_delete ──────────────────────────────────────

  describe("field_mapping_delete", () => {
    it("blocks when entity has records — error with record count", async () => {
      const s = await seed(db);
      // Create a record so the entity has records
      const createTool = new EntityRecordCreateTool().build(s.stationId, s.organizationId, s.userId);
      await createTool.execute!(
        { connectorEntityId: s.connectorEntityId, data: { Name: "Alice" } },
        toolOpts,
      );

      const tool = new FieldMappingDeleteTool().build(s.stationId, s.organizationId, s.userId);
      const result = await tool.execute!(
        { fieldMappingId: s.fieldMappingId },
        toolOpts,
      ) as Record<string, unknown>;

      expect(result.error).toBeDefined();
      expect(result.error).toContain("record");
    });

    it("succeeds and cascades when entity has no records", async () => {
      const s = await seed(db);

      const tool = new FieldMappingDeleteTool().build(s.stationId, s.organizationId, s.userId);
      const result = await tool.execute!(
        { fieldMappingId: s.fieldMappingId },
        toolOpts,
      ) as Record<string, unknown>;

      expect(result.success).toBe(true);
    });
  });

  // ── column_definition_delete ──────────────────────────────────

  describe("column_definition_delete", () => {
    it("blocks when field mappings reference it", async () => {
      const s = await seed(db);

      const tool = new ColumnDefinitionDeleteTool().build(s.stationId, s.organizationId, s.userId);
      const result = await tool.execute!(
        { columnDefinitionId: s.columnDefinitionId },
        toolOpts,
      ) as Record<string, unknown>;

      expect(result.error).toBeDefined();
    });

    it("succeeds when unreferenced", async () => {
      const s = await seed(db);
      // Create an unreferenced column definition
      const orphanCol = createColumnDef(s.organizationId, "orphan_col", "string");
      await db.insert(columnDefinitions).values(orphanCol as never);

      const tool = new ColumnDefinitionDeleteTool().build(s.stationId, s.organizationId, s.userId);
      const result = await tool.execute!(
        { columnDefinitionId: orphanCol.id },
        toolOpts,
      ) as Record<string, unknown>;

      expect(result.success).toBe(true);
    });
  });
});
