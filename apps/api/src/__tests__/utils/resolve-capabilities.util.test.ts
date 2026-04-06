import { describe, it, expect, jest, beforeEach } from "@jest/globals";

// ---------------------------------------------------------------------------
// Mocks — must be declared before dynamic import
// ---------------------------------------------------------------------------

const mockFindByStationId = jest.fn<(...args: unknown[]) => Promise<unknown[]>>();
const mockConnInstanceFindById = jest.fn<(...args: unknown[]) => Promise<unknown>>();
const mockConnDefFindById = jest.fn<(...args: unknown[]) => Promise<unknown>>();
const mockConnEntityFindById = jest.fn<(...args: unknown[]) => Promise<unknown>>();
const mockConnEntityFindByInstanceId = jest.fn<(...args: unknown[]) => Promise<unknown[]>>();

jest.unstable_mockModule(
  "../../db/repositories/station-instances.repository.js",
  () => ({
    stationInstancesRepo: { findByStationId: mockFindByStationId },
  }),
);

jest.unstable_mockModule(
  "../../db/repositories/connector-instances.repository.js",
  () => ({
    connectorInstancesRepo: { findById: mockConnInstanceFindById },
  }),
);

jest.unstable_mockModule(
  "../../db/repositories/connector-definitions.repository.js",
  () => ({
    connectorDefinitionsRepo: { findById: mockConnDefFindById },
  }),
);

jest.unstable_mockModule(
  "../../db/repositories/connector-entities.repository.js",
  () => ({
    connectorEntitiesRepo: {
      findById: mockConnEntityFindById,
      findByConnectorInstanceId: mockConnEntityFindByInstanceId,
    },
  }),
);

const {
  resolveCapabilities,
  resolveStationCapabilities,
  assertStationScope,
  resolveEntityCapabilities,
} = await import("../../utils/resolve-capabilities.util.js");

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

beforeEach(() => {
  jest.clearAllMocks();
});

// ---------------------------------------------------------------------------
// resolveCapabilities (pure function)
// ---------------------------------------------------------------------------

describe("resolveCapabilities", () => {
  it("inherits all definition capabilities when enabledCapabilityFlags is null", () => {
    const definition = { capabilityFlags: { query: true, write: true } };
    const instance = { enabledCapabilityFlags: null };

    expect(resolveCapabilities(definition, instance)).toEqual({
      read: true,
      write: true,
    });
  });

  it("narrows write to false when instance disables it", () => {
    const definition = { capabilityFlags: { query: true, write: true } };
    const instance = { enabledCapabilityFlags: { write: false } };

    expect(resolveCapabilities(definition, instance)).toEqual({
      read: true,
      write: false,
    });
  });

  it("cannot exceed definition ceiling — instance cannot enable write if definition lacks it", () => {
    const definition = { capabilityFlags: { query: true, write: false } };
    const instance = { enabledCapabilityFlags: { write: true } };

    expect(resolveCapabilities(definition, instance)).toEqual({
      read: true,
      write: false,
    });
  });

  it("returns read false when definition has query false", () => {
    const definition = { capabilityFlags: { query: false } };
    const instance = { enabledCapabilityFlags: null };

    expect(resolveCapabilities(definition, instance)).toEqual({
      read: false,
      write: false,
    });
  });

  it("handles definition with no flags set (all undefined)", () => {
    const definition = { capabilityFlags: {} };
    const instance = { enabledCapabilityFlags: null };

    expect(resolveCapabilities(definition, instance)).toEqual({
      read: false,
      write: false,
    });
  });

  it("allows partial overrides — only read set, write inherits", () => {
    const definition = { capabilityFlags: { query: true, write: true } };
    const instance = { enabledCapabilityFlags: { read: true } };

    expect(resolveCapabilities(definition, instance)).toEqual({
      read: true,
      write: true,
    });
  });

  it("instance can disable read independently of write", () => {
    const definition = { capabilityFlags: { query: true, write: true } };
    const instance = { enabledCapabilityFlags: { read: false, write: true } };

    expect(resolveCapabilities(definition, instance)).toEqual({
      read: false,
      write: true,
    });
  });
});

// ---------------------------------------------------------------------------
// resolveStationCapabilities
// ---------------------------------------------------------------------------

describe("resolveStationCapabilities", () => {
  it("returns empty array for station with no instances", async () => {
    mockFindByStationId.mockResolvedValue([]);

    const result = await resolveStationCapabilities("station-1");
    expect(result).toEqual([]);
  });

  it("returns capabilities for each attached instance", async () => {
    mockFindByStationId.mockResolvedValue([
      { connectorInstanceId: "ci-1", stationId: "station-1" },
      { connectorInstanceId: "ci-2", stationId: "station-1" },
    ]);
    mockConnInstanceFindById.mockImplementation(async (id: unknown) => {
      if (id === "ci-1")
        return {
          id: "ci-1",
          connectorDefinitionId: "cd-1",
          enabledCapabilityFlags: null,
        };
      if (id === "ci-2")
        return {
          id: "ci-2",
          connectorDefinitionId: "cd-2",
          enabledCapabilityFlags: null,
        };
      return null;
    });
    mockConnDefFindById.mockImplementation(async (id: unknown) => {
      if (id === "cd-1")
        return { id: "cd-1", capabilityFlags: { query: true, write: true } };
      if (id === "cd-2")
        return { id: "cd-2", capabilityFlags: { query: true, write: false } };
      return null;
    });

    const result = await resolveStationCapabilities("station-1");
    expect(result).toEqual([
      { connectorInstanceId: "ci-1", capabilities: { read: true, write: true } },
      { connectorInstanceId: "ci-2", capabilities: { read: true, write: false } },
    ]);
  });

  it("respects instance-level override narrowing write to false", async () => {
    mockFindByStationId.mockResolvedValue([
      { connectorInstanceId: "ci-1", stationId: "station-1" },
    ]);
    mockConnInstanceFindById.mockResolvedValue({
      id: "ci-1",
      connectorDefinitionId: "cd-1",
      enabledCapabilityFlags: { write: false },
    });
    mockConnDefFindById.mockResolvedValue({
      id: "cd-1",
      capabilityFlags: { query: true, write: true },
    });

    const result = await resolveStationCapabilities("station-1");
    expect(result).toEqual([
      { connectorInstanceId: "ci-1", capabilities: { read: true, write: false } },
    ]);
  });

  it("inherits definition capabilities when override is null", async () => {
    mockFindByStationId.mockResolvedValue([
      { connectorInstanceId: "ci-1", stationId: "station-1" },
    ]);
    mockConnInstanceFindById.mockResolvedValue({
      id: "ci-1",
      connectorDefinitionId: "cd-1",
      enabledCapabilityFlags: null,
    });
    mockConnDefFindById.mockResolvedValue({
      id: "cd-1",
      capabilityFlags: { query: true, write: true },
    });

    const result = await resolveStationCapabilities("station-1");
    expect(result).toEqual([
      { connectorInstanceId: "ci-1", capabilities: { read: true, write: true } },
    ]);
  });

  it("skips instances with missing definitions", async () => {
    mockFindByStationId.mockResolvedValue([
      { connectorInstanceId: "ci-1", stationId: "station-1" },
      { connectorInstanceId: "ci-2", stationId: "station-1" },
    ]);
    mockConnInstanceFindById.mockImplementation(async (id: unknown) => {
      if (id === "ci-1")
        return {
          id: "ci-1",
          connectorDefinitionId: "cd-1",
          enabledCapabilityFlags: null,
        };
      if (id === "ci-2")
        return {
          id: "ci-2",
          connectorDefinitionId: "cd-missing",
          enabledCapabilityFlags: null,
        };
      return null;
    });
    mockConnDefFindById.mockImplementation(async (id: unknown) => {
      if (id === "cd-1")
        return { id: "cd-1", capabilityFlags: { query: true, write: true } };
      return null; // cd-missing not found
    });

    const result = await resolveStationCapabilities("station-1");
    expect(result).toHaveLength(1);
    expect(result[0].connectorInstanceId).toBe("ci-1");
  });
});

// ---------------------------------------------------------------------------
// assertStationScope
// ---------------------------------------------------------------------------

describe("assertStationScope", () => {
  it("passes for entity belonging to an attached instance", async () => {
    mockConnEntityFindById.mockResolvedValue({
      id: "entity-1",
      connectorInstanceId: "ci-1",
    });
    mockFindByStationId.mockResolvedValue([
      { connectorInstanceId: "ci-1", stationId: "station-1" },
    ]);

    await expect(
      assertStationScope("station-1", "entity-1"),
    ).resolves.toBeUndefined();
  });

  it("throws CONNECTOR_ENTITY_NOT_FOUND for non-existent entity", async () => {
    mockConnEntityFindById.mockResolvedValue(null);

    await expect(
      assertStationScope("station-1", "entity-missing"),
    ).rejects.toMatchObject({
      code: "CONNECTOR_ENTITY_NOT_FOUND",
    });
  });

  it("throws STATION_SCOPE_VIOLATION for cross-station entity", async () => {
    mockConnEntityFindById.mockResolvedValue({
      id: "entity-1",
      connectorInstanceId: "ci-other",
    });
    mockFindByStationId.mockResolvedValue([
      { connectorInstanceId: "ci-1", stationId: "station-1" },
    ]);

    await expect(
      assertStationScope("station-1", "entity-1"),
    ).rejects.toMatchObject({
      code: "STATION_SCOPE_VIOLATION",
    });
  });
});

// ---------------------------------------------------------------------------
// resolveEntityCapabilities
// ---------------------------------------------------------------------------

describe("resolveEntityCapabilities", () => {
  it("returns capability map keyed by entity ID", async () => {
    mockFindByStationId.mockResolvedValue([
      { connectorInstanceId: "ci-1", stationId: "station-1" },
    ]);
    mockConnInstanceFindById.mockResolvedValue({
      id: "ci-1",
      connectorDefinitionId: "cd-1",
      enabledCapabilityFlags: null,
    });
    mockConnDefFindById.mockResolvedValue({
      id: "cd-1",
      capabilityFlags: { query: true, write: true },
    });
    mockConnEntityFindByInstanceId.mockResolvedValue([
      { id: "entity-1", connectorInstanceId: "ci-1" },
      { id: "entity-2", connectorInstanceId: "ci-1" },
    ]);

    const result = await resolveEntityCapabilities("station-1");
    expect(result).toEqual({
      "entity-1": { read: true, write: true },
      "entity-2": { read: true, write: true },
    });
  });

  it("returns empty map for station with no instances", async () => {
    mockFindByStationId.mockResolvedValue([]);

    const result = await resolveEntityCapabilities("station-1");
    expect(result).toEqual({});
  });
});
