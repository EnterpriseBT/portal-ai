import { jest, describe, it, expect, beforeEach } from "@jest/globals";

const mockUseAuthQuery = jest.fn();
const mockUseAuthMutation = jest.fn();

jest.unstable_mockModule("../../utils/api.util", () => ({
  useAuthQuery: mockUseAuthQuery,
  useAuthMutation: mockUseAuthMutation,
}));

const { stations } = await import("../../api/stations.api");
const { queryKeys } = await import("../../api/keys");

describe("stations.api", () => {
  beforeEach(() => {
    mockUseAuthQuery.mockReset();
    mockUseAuthMutation.mockReset();
  });

  describe("list", () => {
    it("calls correct endpoint with no params", () => {
      stations.list();
      expect(mockUseAuthQuery).toHaveBeenCalledWith(
        queryKeys.stations.list(undefined),
        "/api/stations",
        undefined,
        undefined
      );
    });

    it("calls correct endpoint with params", () => {
      const params = {
        limit: 10,
        offset: 0,
        sortBy: "created",
        sortOrder: "asc" as const,
        search: "test",
      };
      stations.list(params);
      expect(mockUseAuthQuery).toHaveBeenCalledWith(
        queryKeys.stations.list(params),
        "/api/stations?limit=10&offset=0&sortBy=created&sortOrder=asc&search=test",
        undefined,
        undefined
      );
    });
  });

  describe("get", () => {
    it("calls correct endpoint by id", () => {
      stations.get("station-123");
      expect(mockUseAuthQuery).toHaveBeenCalledWith(
        queryKeys.stations.get("station-123"),
        "/api/stations/station-123",
        undefined,
        undefined
      );
    });

    // #300: the key used to drop `params` while the URL used them, so a
    // caller with `include` and a caller without shared one cache entry
    // holding two different payload shapes — the portal header rendered a
    // connector UUID whenever the un-enriched fetch owned the entry.
    it("keys enriched and un-enriched fetches separately", () => {
      const bare = queryKeys.stations.get("station-123");
      const enriched = queryKeys.stations.get("station-123", {
        include: "connectorInstance",
      });
      expect(enriched).not.toEqual(bare);
    });

    it("threads params into both the key and the URL", () => {
      stations.get("station-123", { include: "connectorInstance" });
      expect(mockUseAuthQuery).toHaveBeenCalledWith(
        queryKeys.stations.get("station-123", {
          include: "connectorInstance",
        }),
        "/api/stations/station-123?include=connectorInstance",
        undefined,
        undefined
      );
    });

    it("keeps stations.root a prefix of every get key", () => {
      // This is what keeps the ~10 invalidateQueries({ queryKey:
      // stations.root }) call sites reaching both cache entries. A future
      // refactor could break it silently; this case is the tripwire.
      const root = queryKeys.stations.root;
      for (const key of [
        queryKeys.stations.get("station-123"),
        queryKeys.stations.get("station-123", {
          include: "connectorInstance",
        }),
      ]) {
        expect(key.slice(0, root.length)).toEqual([...root]);
      }
    });

    it("encodes id in URL", () => {
      stations.get("station/with/slashes");
      expect(mockUseAuthQuery).toHaveBeenCalledWith(
        expect.anything(),
        "/api/stations/station%2Fwith%2Fslashes",
        undefined,
        undefined
      );
    });
  });

  describe("create", () => {
    it("sends POST to /api/stations", () => {
      stations.create();
      expect(mockUseAuthMutation).toHaveBeenCalledWith({
        url: "/api/stations",
      });
    });
  });

  describe("update", () => {
    it("sends PATCH to /api/stations/:id", () => {
      stations.update("station-123");
      expect(mockUseAuthMutation).toHaveBeenCalledWith({
        url: "/api/stations/station-123",
        method: "PATCH",
      });
    });
  });

  describe("setDefault", () => {
    it("sends PATCH to /api/organization/:orgId with defaultStationId payload", () => {
      stations.setDefault("org-456");
      expect(mockUseAuthMutation).toHaveBeenCalledWith({
        url: "/api/organization/org-456",
        method: "PATCH",
      });
    });
  });
});
