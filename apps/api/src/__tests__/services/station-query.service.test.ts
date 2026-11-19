import { jest, describe, it, expect, beforeEach } from "@jest/globals";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockFindMany = jest.fn<(...a: unknown[]) => Promise<unknown[]>>();
const mockCount = jest.fn<(...a: unknown[]) => Promise<number>>();
const mockToolpacks = jest.fn<(ids: string[]) => Promise<unknown[]>>();
const mockLoadSet = jest.fn<(...a: unknown[]) => Promise<unknown>>();
const mockVisibility = jest.fn<(...a: unknown[]) => unknown>();
const mockFindNames =
  jest.fn<
    (
      ids: string[],
      opts: { organizationId: string }
    ) => Promise<{ id: string; name: string }[]>
  >();

jest.unstable_mockModule("../../services/db.service.js", () => ({
  DbService: {
    repository: {
      stations: { findMany: mockFindMany, count: mockCount },
      stationToolpacks: { findByStationIds: mockToolpacks },
      organizationToolpacks: { findNamesByIds: mockFindNames },
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
  mockFindNames.mockResolvedValue([]);
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

  describe("names each station's packs (#1063)", () => {
    beforeEach(() => {
      mockFindMany.mockResolvedValue([station("s1"), station("s2")]);
      mockCount.mockResolvedValue(2);
      mockToolpacks.mockResolvedValue([
        {
          stationId: "s1",
          builtinSlug: "data_query",
          organizationToolpackId: null,
        },
        { stationId: "s1", builtinSlug: null, organizationToolpackId: "tp-9" },
        { stationId: "s2", builtinSlug: null, organizationToolpackId: "tp-9" },
        { stationId: "s2", builtinSlug: null, organizationToolpackId: "tp-7" },
      ]);
    });

    it("gives each row its packs with names, in ref order", async () => {
      mockFindNames.mockResolvedValue([
        { id: "tp-7", name: "Beta Tools" },
        { id: "tp-9", name: "Acme CRM" },
      ]);

      const result = await StationQueryService.listForCaller(CTX, OPTS);

      expect(result.stations[0].toolpacks).toEqual([
        { ref: "data_query", kind: "builtin", name: "Data Query" },
        { ref: "org:tp-9", kind: "custom", name: "Acme CRM" },
      ]);
      expect(result.stations[1].toolpacks).toEqual([
        { ref: "org:tp-9", kind: "custom", name: "Acme CRM" },
        { ref: "org:tp-7", kind: "custom", name: "Beta Tools" },
      ]);
    });

    it("looks the names up once for the page, scoped to the org", async () => {
      await StationQueryService.listForCaller(CTX, OPTS);

      expect(mockFindNames).toHaveBeenCalledTimes(1);
      const [ids, opts] = mockFindNames.mock.calls[0];
      expect([...ids].sort()).toEqual(["tp-7", "tp-9"]);
      expect(opts).toEqual({ organizationId: "org-1" });
    });

    it("gives no item for a custom pack that no longer exists", async () => {
      mockFindNames.mockResolvedValue([{ id: "tp-9", name: "Acme CRM" }]);

      const result = await StationQueryService.listForCaller(CTX, OPTS);

      expect(result.stations[1].enabledToolpacks).toEqual([
        "org:tp-9",
        "org:tp-7",
      ]);
      expect(result.stations[1].toolpacks).toEqual([
        { ref: "org:tp-9", kind: "custom", name: "Acme CRM" },
      ]);
    });
  });
});
