import { jest, describe, it, expect, beforeEach } from "@jest/globals";

const mockUseAuthQuery = jest.fn();
const mockUseAuthMutation = jest.fn();

jest.unstable_mockModule("../../utils/api.util", () => ({
  useAuthQuery: mockUseAuthQuery,
  useAuthMutation: mockUseAuthMutation,
}));

const { stationTools } = await import("../../api/station-tools.api");
const { queryKeys } = await import("../../api/keys");

describe("station-tools.api", () => {
  beforeEach(() => {
    mockUseAuthQuery.mockReset();
    mockUseAuthMutation.mockReset();
  });

  describe("list", () => {
    it("calls correct endpoint with stationId", () => {
      stationTools.list("station-123");
      expect(mockUseAuthQuery).toHaveBeenCalledWith(
        queryKeys.stationTools.list("station-123", undefined),
        "/api/stations/station-123/tools",
        undefined,
        undefined
      );
    });

    it("calls correct endpoint with stationId and params", () => {
      const params = {
        limit: 5,
        offset: 0,
        sortBy: "created",
        sortOrder: "asc" as const,
      };
      stationTools.list("station-123", params);
      expect(mockUseAuthQuery).toHaveBeenCalledWith(
        queryKeys.stationTools.list("station-123", params),
        "/api/stations/station-123/tools?limit=5&offset=0&sortBy=created&sortOrder=asc",
        undefined,
        undefined
      );
    });
  });

  describe("assign", () => {
    it("sends POST to /api/stations/:stationId/tools", () => {
      stationTools.assign("station-123");
      expect(mockUseAuthMutation).toHaveBeenCalledWith({
        url: "/api/stations/station-123/tools",
      });
    });
  });

  describe("unassign", () => {
    it("sends DELETE to /api/stations/:stationId/tools/:assignmentId", () => {
      stationTools.unassign("station-123", "assignment-456");
      expect(mockUseAuthMutation).toHaveBeenCalledWith({
        url: "/api/stations/station-123/tools/assignment-456",
        method: "DELETE",
      });
    });
  });
});
