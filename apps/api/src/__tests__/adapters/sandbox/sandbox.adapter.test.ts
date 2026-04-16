/**
 * Unit tests for the Sandbox adapter.
 *
 * All repository calls are mocked so these run without a database.
 */

import { describe, it, expect, beforeEach, jest } from "@jest/globals";
import type { ConnectorInstance } from "@portalai/core/models";
import type { EntityDataQuery } from "../../../adapters/adapter.interface.js";

// ── Mocks ───────────────────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const mockFindByKey = jest.fn<any>();
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const mockFindByConnectorEntityId = jest.fn<any>();
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const mockCountByConnectorEntityId = jest.fn<any>();
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const mockFindMappingsByEntityId = jest.fn<any>();
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const mockFindColDefById = jest.fn<any>();

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
const { sandboxAdapter } = await import(
  "../../../adapters/sandbox/sandbox.adapter.js"
);

// ── Fixtures ────────────────────────────────────────────────────────

const stubInstance: ConnectorInstance = {
  id: "inst-sandbox-1",
  connectorDefinitionId: "def-sandbox",
  organizationId: "org-1",
  name: "Sandbox",
  status: "active",
  config: null,
  credentials: null,
  lastSyncAt: null,
  lastErrorMessage: null,
  enabledCapabilityFlags: null,
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
  connectorInstanceId: "inst-sandbox-1",
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
    normalizedKey: "first_name",
    isPrimaryKey: false,
    required: false,
    defaultValue: null,
    enumValues: null,
    format: null,
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
    normalizedKey: "email",
    isPrimaryKey: true,
    required: true,
    defaultValue: null,
    enumValues: null,
    format: "email",
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
    validationPattern: null,
    canonicalFormat: null,
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
    validationPattern: null,
    canonicalFormat: null,
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

describe("sandboxAdapter", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  // ── queryRows ───────────────────────────────────────────────────

  describe("queryRows", () => {
    it("returns rows from entity_records", async () => {
      setupMocks();
      const result = await sandboxAdapter.queryRows(stubInstance, baseQuery());

      expect(mockFindByKey).toHaveBeenCalledWith("inst-sandbox-1", "contacts");
      expect(result.rows).toHaveLength(2);
      expect(result.total).toBe(2);
    });

    it("returns source: 'cache'", async () => {
      setupMocks();
      const result = await sandboxAdapter.queryRows(stubInstance, baseQuery());
      expect(result.source).toBe("cache");
    });

    it("returns column metadata from field mappings", async () => {
      setupMocks();
      const result = await sandboxAdapter.queryRows(stubInstance, baseQuery());

      expect(result.columns).toEqual(
        expect.arrayContaining([
          { key: "first_name", normalizedKey: "first_name", label: "First Name", type: "string", required: false, enumValues: null, defaultValue: null, format: null, validationPattern: null, canonicalFormat: null },
          { key: "email", normalizedKey: "email", label: "Email", type: "string", required: true, enumValues: null, defaultValue: null, format: "email", validationPattern: null, canonicalFormat: null },
        ])
      );
    });

    it("returns empty result for unknown entity key", async () => {
      setupMocks({ entity: null });
      const result = await sandboxAdapter.queryRows(
        stubInstance,
        baseQuery({ entityKey: "unknown" })
      );

      expect(result.rows).toEqual([]);
      expect(result.total).toBe(0);
      expect(result.columns).toEqual([]);
    });
  });

  // ── syncEntity ──────────────────────────────────────────────────

  describe("syncEntity", () => {
    it("returns zero counts (no-op)", async () => {
      const result = await sandboxAdapter.syncEntity(stubInstance, "contacts");
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
      const result = await sandboxAdapter.discoverEntities(stubInstance);
      expect(result).toEqual([]);
    });
  });

  // ── discoverColumns ─────────────────────────────────────────────

  describe("discoverColumns", () => {
    it("returns empty array", async () => {
      const result = await sandboxAdapter.discoverColumns(
        stubInstance,
        "contacts"
      );
      expect(result).toEqual([]);
    });
  });
});
