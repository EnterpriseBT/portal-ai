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
      const params = { limit: 10, offset: 0, sortBy: "created", sortOrder: "asc" as const, search: "test" };
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
