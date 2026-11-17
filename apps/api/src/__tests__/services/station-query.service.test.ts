import { jest, describe, it, expect, beforeEach } from "@jest/globals";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockFindMany = jest.fn<(...a: unknown[]) => Promise<unknown[]>>();
const mockCount = jest.fn<(...a: unknown[]) => Promise<number>>();
const mockToolpacks = jest.fn<(ids: string[]) => Promise<unknown[]>>();
const mockLoadSet = jest.fn<(...a: unknown[]) => Promise<unknown>>();
const mockVisibility = jest.fn<(...a: unknown[]) => unknown>();

jest.unstable_mockModule("../../services/db.service.js", () => ({
  DbService: {
    repository: {
      stations: { findMany: mockFindMany, count: mockCount },
      stationToolpacks: { findByStationIds: mockToolpacks },
    },
  },
}));

jest.unstable_mockModule("../../services/permission.service.js", () => ({
  PermissionService: { loadSet: mockLoadSet },
}));

const { StationQueryService } =
  await import("../../services/station-query.service.js");

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const CTX = { userId: "u1", organizationId: "org-1", roles: [] as never[] };
const OPTS = {
  limit: 10,
  offset: 0,
  sortBy: "name" as const,
  sortOrder: "asc" as const,
};

const station = (id: string, createdBy = "u1") => ({
  id,
  organizationId: "org-1",
  name: id,
  createdBy,
});

beforeEach(() => {
  jest.clearAllMocks();
  mockLoadSet.mockResolvedValue({
    visibilityPredicate: mockVisibility,
    // Read on every station; write only on the caller's own.
    can: (action: string, o?: { createdBy?: string }) =>
      action === "resource.read" || o?.createdBy === "u1",
  });
  mockVisibility.mockReturnValue(undefined);
  mockToolpacks.mockResolvedValue([]);
});

// ---------------------------------------------------------------------------
// listForCaller (#1036)
// ---------------------------------------------------------------------------

describe("StationQueryService.listForCaller (#1036)", () => {
  it("pages the stations and returns the total", async () => {
    mockFindMany.mockResolvedValue([station("s1"), station("s2")]);
    mockCount.mockResolvedValue(7);

    const result = await StationQueryService.listForCaller(CTX, OPTS);

    expect(result.total).toBe(7);
    expect(result.stations.map((s) => s.id)).toEqual(["s1", "s2"]);
    const [, listOpts] = mockFindMany.mock.calls[0] as [
      unknown,
      { limit: number; offset: number },
    ];
    expect(listOpts).toMatchObject({ limit: 10, offset: 0 });
  });

  it("applies the caller's station visibility predicate", async () => {
    mockFindMany.mockResolvedValue([]);
    mockCount.mockResolvedValue(0);

    await StationQueryService.listForCaller(CTX, OPTS);

    expect(mockLoadSet).toHaveBeenCalledWith(CTX);
    expect(mockVisibility).toHaveBeenCalledWith(
      "station",
      expect.objectContaining({ createdByCol: expect.anything() })
    );
  });

  it("hydrates enabledToolpacks in one grouped lookup", async () => {
    mockFindMany.mockResolvedValue([station("s1"), station("s2")]);
    mockCount.mockResolvedValue(2);
    mockToolpacks.mockResolvedValue([
      {
        stationId: "s1",
        builtinSlug: "data_query",
        organizationToolpackId: null,
      },
      { stationId: "s1", builtinSlug: null, organizationToolpackId: "tp-9" },
      {
        stationId: "s2",
        builtinSlug: "view_management",
        organizationToolpackId: null,
      },
    ]);

    const result = await StationQueryService.listForCaller(CTX, OPTS);

    expect(mockToolpacks).toHaveBeenCalledTimes(1);
    expect(mockToolpacks).toHaveBeenCalledWith(["s1", "s2"]);
    expect(result.stations[0].enabledToolpacks).toEqual([
      "data_query",
      "org:tp-9",
    ]);
    expect(result.stations[1].enabledToolpacks).toEqual(["view_management"]);
  });

  it("attaches the caller's capabilities to each row", async () => {
    mockFindMany.mockResolvedValue([station("s1"), station("s2", "other")]);
    mockCount.mockResolvedValue(2);

    const result = await StationQueryService.listForCaller(CTX, OPTS);

    expect(result.stations[0].capabilities).toMatchObject({
      read: true,
      write: true,
    });
    expect(result.stations[1].capabilities).toMatchObject({
      read: true,
      write: false,
    });
  });
});
