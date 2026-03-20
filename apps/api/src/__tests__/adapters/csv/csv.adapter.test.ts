/**
 * Unit tests for the CSV adapter.
 *
 * All repository calls are mocked so these run without a database.
 */

import { describe, it, expect, beforeEach, jest } from "@jest/globals";
import type { ConnectorInstance } from "@portalai/core/models";
import type { EntityDataQuery } from "../../../adapters/adapter.interface.js";

// ── Mocks ───────────────────────────────────────────────────────────

// We need to mock the repository modules before importing the adapter.
// jest.unstable_mockModule replaces the module at import time.

const mockFindByKey = jest.fn();
const mockFindByConnectorEntityId = jest.fn();
const mockCountByConnectorEntityId = jest.fn();
const mockFindMappingsByEntityId = jest.fn();
const mockFindColDefById = jest.fn();

jest.unstable_mockModule(
  "../../../db/repositories/connector-entities.repository.js",
  () => ({
    connectorEntitiesRepo: { findByKey: mockFindByKey },
  })
);

jest.unstable_mockModule(
  "../../../db/repositories/entity-records.repository.js",
  () => ({
    entityRecordsRepo: {
      findByConnectorEntityId: mockFindByConnectorEntityId,
      countByConnectorEntityId: mockCountByConnectorEntityId,
    },
  })
);

jest.unstable_mockModule(
  "../../../db/repositories/field-mappings.repository.js",
  () => ({
    fieldMappingsRepo: {
      findByConnectorEntityId: mockFindMappingsByEntityId,
    },
  })
);

jest.unstable_mockModule(
  "../../../db/repositories/column-definitions.repository.js",
  () => ({
    columnDefinitionsRepo: { findById: mockFindColDefById },
  })
);

// Dynamic import after mocks are in place
const { csvAdapter } = await import(
  "../../../adapters/csv/csv.adapter.js"
);

// ── Fixtures ────────────────────────────────────────────────────────

const stubInstance: ConnectorInstance = {
  id: "inst-1",
  connectorDefinitionId: "def-csv",
  organizationId: "org-1",
  name: "My CSV",
  status: "active",
  config: null,
  credentials: null,
  lastSyncAt: null,
  lastErrorMessage: null,
  created: Date.now(),
  createdBy: "system",
  updated: null,
  updatedBy: null,
  deleted: null,
  deletedBy: null,
};

const stubEntity = {
  id: "ent-1",
  organizationId: "org-1",
  connectorInstanceId: "inst-1",
  key: "contacts",
  label: "Contacts",
  created: Date.now(),
  createdBy: "system",
  updated: null,
  updatedBy: null,
  deleted: null,
  deletedBy: null,
};

const stubMappings = [
  {
    id: "fm-1",
    connectorEntityId: "ent-1",
    columnDefinitionId: "cd-1",
    sourceField: "First Name",
    isPrimaryKey: false,
    organizationId: "org-1",
    created: Date.now(),
    createdBy: "system",
    updated: null,
    updatedBy: null,
    deleted: null,
    deletedBy: null,
  },
  {
    id: "fm-2",
    connectorEntityId: "ent-1",
    columnDefinitionId: "cd-2",
    sourceField: "Email",
    isPrimaryKey: true,
    organizationId: "org-1",
    created: Date.now(),
    createdBy: "system",
    updated: null,
    updatedBy: null,
    deleted: null,
    deletedBy: null,
  },
];

const stubColDefs = [
  {
    id: "cd-1",
    organizationId: "org-1",
    key: "first_name",
    label: "First Name",
    type: "string",
    required: false,
    defaultValue: null,
    format: null,
    enumValues: null,
    description: null,
    created: Date.now(),
    createdBy: "system",
    updated: null,
    updatedBy: null,
    deleted: null,
    deletedBy: null,
  },
  {
    id: "cd-2",
    organizationId: "org-1",
    key: "email",
    label: "Email",
    type: "string",
    required: true,
    defaultValue: null,
    format: "email",
    enumValues: null,
    description: null,
    created: Date.now(),
    createdBy: "system",
    updated: null,
    updatedBy: null,
    deleted: null,
    deletedBy: null,
  },
];

const stubRecords = [
  {
    id: "rec-1",
    organizationId: "org-1",
    connectorEntityId: "ent-1",
    data: { "First Name": "Jane", Email: "jane@ex.com" },
    normalizedData: { first_name: "Jane", email: "jane@ex.com" },
    sourceId: "0",
    checksum: "aaa",
    syncedAt: Date.now(),
    created: Date.now(),
    createdBy: "system",
    updated: null,
    updatedBy: null,
    deleted: null,
    deletedBy: null,
  },
  {
    id: "rec-2",
    organizationId: "org-1",
    connectorEntityId: "ent-1",
    data: { "First Name": "Bob", Email: "bob@ex.com" },
    normalizedData: { first_name: "Bob", email: "bob@ex.com" },
    sourceId: "1",
    checksum: "bbb",
    syncedAt: Date.now(),
    created: Date.now(),
    createdBy: "system",
    updated: null,
    updatedBy: null,
    deleted: null,
    deletedBy: null,
  },
  {
    id: "rec-3",
    organizationId: "org-1",
    connectorEntityId: "ent-1",
    data: { "First Name": "Alice", Email: "alice@ex.com" },
    normalizedData: { first_name: "Alice", email: "alice@ex.com" },
    sourceId: "2",
    checksum: "ccc",
    syncedAt: Date.now(),
    created: Date.now(),
    createdBy: "system",
    updated: null,
    updatedBy: null,
    deleted: null,
    deletedBy: null,
  },
];

// ── Helpers ─────────────────────────────────────────────────────────

function setupMocks(overrides?: {
  entity?: typeof stubEntity | null;
  records?: typeof stubRecords;
  count?: number;
}) {
  const ent = overrides?.entity === null ? undefined : (overrides?.entity ?? stubEntity);
  mockFindByKey.mockResolvedValue(ent);
  mockFindByConnectorEntityId.mockResolvedValue(
    overrides?.records ?? stubRecords
  );
  mockCountByConnectorEntityId.mockResolvedValue(
    overrides?.count ?? (overrides?.records ?? stubRecords).length
  );
  mockFindMappingsByEntityId.mockResolvedValue(stubMappings);
  mockFindColDefById.mockImplementation(
    async (id: string) => stubColDefs.find((cd) => cd.id === id) ?? null
  );
}

function baseQuery(overrides?: Partial<EntityDataQuery>): EntityDataQuery {
  return {
    entityKey: "contacts",
    limit: 25,
    offset: 0,
    ...overrides,
  };
}

// ── Tests ───────────────────────────────────────────────────────────

describe("csvAdapter", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  // ── accessMode ──────────────────────────────────────────────────

  it("has accessMode 'import'", () => {
    expect(csvAdapter.accessMode).toBe("import");
  });

  // ── queryRows ───────────────────────────────────────────────────

  describe("queryRows", () => {
    it("returns rows from entity_records filtered by connectorEntityId", async () => {
      setupMocks();
      const result = await csvAdapter.queryRows(stubInstance, baseQuery());

      expect(mockFindByKey).toHaveBeenCalledWith("inst-1", "contacts");
      expect(mockFindByConnectorEntityId).toHaveBeenCalledWith(
        "ent-1",
        expect.objectContaining({ limit: 25, offset: 0 })
      );
      expect(result.rows).toHaveLength(3);
      expect(result.total).toBe(3);
    });

    it("respects limit and offset pagination params", async () => {
      setupMocks();
      await csvAdapter.queryRows(
        stubInstance,
        baseQuery({ limit: 10, offset: 5 })
      );

      expect(mockFindByConnectorEntityId).toHaveBeenCalledWith(
        "ent-1",
        expect.objectContaining({ limit: 10, offset: 5 })
      );
    });

    it("returns source: 'cache' for import-mode adapter", async () => {
      setupMocks();
      const result = await csvAdapter.queryRows(stubInstance, baseQuery());
      expect(result.source).toBe("cache");
    });

    it("returns column metadata from field mappings and column definitions", async () => {
      setupMocks();
      const result = await csvAdapter.queryRows(stubInstance, baseQuery());

      expect(result.columns).toEqual(
        expect.arrayContaining([
          { key: "first_name", label: "First Name", type: "string" },
          { key: "email", label: "Email", type: "string" },
        ])
      );
    });

    it("returns only requested columns when specified", async () => {
      setupMocks();
      const result = await csvAdapter.queryRows(
        stubInstance,
        baseQuery({ columns: ["email"] })
      );

      // Rows should only contain the email key
      for (const row of result.rows) {
        expect(Object.keys(row)).toEqual(["email"]);
      }
      // Column metadata should only include email
      expect(result.columns).toHaveLength(1);
      expect(result.columns[0].key).toBe("email");
    });

    it("applies sort by column ascending", async () => {
      setupMocks();
      const result = await csvAdapter.queryRows(
        stubInstance,
        baseQuery({ sort: { column: "first_name", direction: "asc" } })
      );

      const names = result.rows.map((r) => r.first_name);
      expect(names).toEqual(["Alice", "Bob", "Jane"]);
    });

    it("applies sort by column descending", async () => {
      setupMocks();
      const result = await csvAdapter.queryRows(
        stubInstance,
        baseQuery({ sort: { column: "first_name", direction: "desc" } })
      );

      const names = result.rows.map((r) => r.first_name);
      expect(names).toEqual(["Jane", "Bob", "Alice"]);
    });

    it("applies filters with eq operator", async () => {
      setupMocks();
      const result = await csvAdapter.queryRows(
        stubInstance,
        baseQuery({
          filters: { first_name: { op: "eq", value: "Jane" } },
        })
      );

      expect(result.rows).toHaveLength(1);
      expect(result.rows[0].first_name).toBe("Jane");
    });

    it("applies filters with neq operator", async () => {
      setupMocks();
      const result = await csvAdapter.queryRows(
        stubInstance,
        baseQuery({
          filters: { first_name: { op: "neq", value: "Jane" } },
        })
      );

      expect(result.rows).toHaveLength(2);
      expect(result.rows.map((r) => r.first_name)).not.toContain("Jane");
    });

    it("applies filters with contains operator (case-insensitive)", async () => {
      setupMocks();
      const result = await csvAdapter.queryRows(
        stubInstance,
        baseQuery({
          filters: { email: { op: "contains", value: "BOB" } },
        })
      );

      expect(result.rows).toHaveLength(1);
      expect(result.rows[0].email).toBe("bob@ex.com");
    });

    it("returns empty result for unknown entity key", async () => {
      setupMocks({ entity: null });
      const result = await csvAdapter.queryRows(
        stubInstance,
        baseQuery({ entityKey: "unknown" })
      );

      expect(result.rows).toEqual([]);
      expect(result.total).toBe(0);
      expect(result.columns).toEqual([]);
    });

    it("returns empty rows when no records exist", async () => {
      setupMocks({ records: [], count: 0 });
      const result = await csvAdapter.queryRows(stubInstance, baseQuery());

      expect(result.rows).toEqual([]);
      expect(result.total).toBe(0);
      expect(result.source).toBe("cache");
    });
  });

  // ── syncEntity ──────────────────────────────────────────────────

  describe("syncEntity", () => {
    it("returns zero counts (no-op for import-mode)", async () => {
      const result = await csvAdapter.syncEntity(stubInstance, "contacts");
      expect(result).toEqual({
        created: 0,
        updated: 0,
        unchanged: 0,
        errors: 0,
      });
    });
  });

  // ── discoverEntities ────────────────────────────────────────────

  describe("discoverEntities", () => {
    it("returns empty array", async () => {
      const result = await csvAdapter.discoverEntities(stubInstance);
      expect(result).toEqual([]);
    });
  });

  // ── discoverColumns ─────────────────────────────────────────────

  describe("discoverColumns", () => {
    it("returns empty array", async () => {
      const result = await csvAdapter.discoverColumns(
        stubInstance,
        "contacts"
      );
      expect(result).toEqual([]);
    });
  });
});
