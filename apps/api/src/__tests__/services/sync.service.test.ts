/**
 * Unit tests for SyncService.
 *
 * All repository and adapter calls are mocked.
 */

import { describe, it, expect, beforeEach, jest } from "@jest/globals";

// ── Mocks ───────────────────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const mockFindEntityById = jest.fn<(...args: any[]) => any>();
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const mockFindInstanceById = jest.fn<(...args: any[]) => any>();
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const mockFindDefinitionById = jest.fn<(...args: any[]) => any>();
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const mockUpdateInstance = jest.fn<(...args: any[]) => any>();

jest.unstable_mockModule("../../services/db.service.js", () => ({
  DbService: {
    repository: {
      connectorEntities: { findById: mockFindEntityById },
      connectorInstances: {
        findById: mockFindInstanceById,
        update: mockUpdateInstance,
      },
      connectorDefinitions: { findById: mockFindDefinitionById },
    },
  },
}));

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const mockAdapterSyncEntity = jest.fn<(...args: any[]) => any>();
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const mockRegistryGet = jest.fn<(...args: any[]) => any>();

jest.unstable_mockModule("../../adapters/adapter.registry.js", () => ({
  ConnectorAdapterRegistry: {
    get: mockRegistryGet,
  },
}));

const { SyncService } = await import("../../services/sync.service.js");

// ── Fixtures ────────────────────────────────────────────────────────

const stubEntity = {
  id: "ent-1",
  connectorInstanceId: "inst-1",
  organizationId: "org-1",
  key: "contacts",
  label: "Contacts",
};

const stubInstance = {
  id: "inst-1",
  connectorDefinitionId: "def-1",
  organizationId: "org-1",
  name: "My CSV",
  status: "active",
  config: null,
  credentials: null,
  lastSyncAt: null,
  lastErrorMessage: null,
  enabledCapabilityFlags: null,
};

const stubDefinition = {
  id: "def-1",
  slug: "csv",
  display: "CSV Connector",
  category: "File-based",
  authType: "none",
  configSchema: null,
  capabilityFlags: { sync: true, read: true, write: false },
  isActive: true,
  version: "1.0.0",
  iconUrl: null,
};

const stubSyncResult = {
  created: 5,
  updated: 2,
  unchanged: 10,
  errors: 0,
};

// ── Helpers ─────────────────────────────────────────────────────────

function setupMocks() {
  mockFindEntityById.mockResolvedValue(stubEntity);
  mockFindInstanceById.mockResolvedValue(stubInstance);
  mockFindDefinitionById.mockResolvedValue(stubDefinition);
  mockUpdateInstance.mockResolvedValue(stubInstance);
  mockAdapterSyncEntity.mockResolvedValue(stubSyncResult);
  mockRegistryGet.mockReturnValue({
    syncEntity: mockAdapterSyncEntity,
  });
}

// ── Tests ───────────────────────────────────────────────────────────

describe("SyncService", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe("syncEntity", () => {
    it("loads entity → instance → definition → adapter chain correctly", async () => {
      setupMocks();
      await SyncService.syncEntity("ent-1", "user-1");

      expect(mockFindEntityById).toHaveBeenCalledWith("ent-1");
      expect(mockFindInstanceById).toHaveBeenCalledWith("inst-1");
      expect(mockFindDefinitionById).toHaveBeenCalledWith("def-1");
      expect(mockRegistryGet).toHaveBeenCalledWith("csv");
    });

    it("delegates to the adapter's syncEntity method", async () => {
      setupMocks();
      await SyncService.syncEntity("ent-1", "user-1");

      expect(mockAdapterSyncEntity).toHaveBeenCalledWith(
        stubInstance,
        "contacts"
      );
    });

    it("updates connectorInstance.lastSyncAt after successful sync", async () => {
      setupMocks();
      const before = Date.now();
      await SyncService.syncEntity("ent-1", "user-1");
      const after = Date.now();

      expect(mockUpdateInstance).toHaveBeenCalledWith(
        "inst-1",
        expect.objectContaining({
          updatedBy: "user-1",
        })
      );

      const callArg = mockUpdateInstance.mock.calls[0][1] as {
        lastSyncAt: number;
      };
      expect(callArg.lastSyncAt).toBeGreaterThanOrEqual(before);
      expect(callArg.lastSyncAt).toBeLessThanOrEqual(after);
    });

    it("returns the sync result from the adapter", async () => {
      setupMocks();
      const result = await SyncService.syncEntity("ent-1", "user-1");

      expect(result).toEqual(stubSyncResult);
    });

    it("throws when connector entity is not found", async () => {
      setupMocks();
      mockFindEntityById.mockResolvedValue(undefined);

      await expect(SyncService.syncEntity("missing", "user-1")).rejects.toThrow(
        "Connector entity not found: missing"
      );
    });

    it("throws when connector instance is not found", async () => {
      setupMocks();
      mockFindInstanceById.mockResolvedValue(undefined);

      await expect(SyncService.syncEntity("ent-1", "user-1")).rejects.toThrow(
        "Connector instance not found: inst-1"
      );
    });

    it("throws when connector definition is not found", async () => {
      setupMocks();
      mockFindDefinitionById.mockResolvedValue(undefined);

      await expect(SyncService.syncEntity("ent-1", "user-1")).rejects.toThrow(
        "Connector definition not found: def-1"
      );
    });

    it("propagates adapter errors without masking them", async () => {
      setupMocks();
      const adapterError = new Error("External API failed");
      mockAdapterSyncEntity.mockRejectedValue(adapterError);

      await expect(SyncService.syncEntity("ent-1", "user-1")).rejects.toThrow(
        "External API failed"
      );
    });

    it("does not update lastSyncAt when adapter throws", async () => {
      setupMocks();
      mockAdapterSyncEntity.mockRejectedValue(new Error("fail"));

      await expect(SyncService.syncEntity("ent-1", "user-1")).rejects.toThrow();

      expect(mockUpdateInstance).not.toHaveBeenCalled();
    });
  });
});
