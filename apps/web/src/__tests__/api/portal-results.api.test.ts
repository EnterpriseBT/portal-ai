import { jest, describe, it, expect, beforeEach } from "@jest/globals";

const mockUseAuthQuery = jest.fn();
const mockUseAuthMutation = jest.fn();

jest.unstable_mockModule("../../utils/api.util", () => ({
  useAuthQuery: mockUseAuthQuery,
  useAuthMutation: mockUseAuthMutation,
}));

const { portalResults } = await import("../../api/portal-results.api");
const { queryKeys } = await import("../../api/keys");

describe("portal-results.api", () => {
  beforeEach(() => {
    mockUseAuthQuery.mockReset();
    mockUseAuthMutation.mockReset();
  });

  describe("list", () => {
    it("calls correct endpoint with no params", () => {
      portalResults.list();
      expect(mockUseAuthQuery).toHaveBeenCalledWith(
        queryKeys.portalResults.list(undefined),
        "/api/portal-results",
        undefined,
        undefined
      );
    });

    it("calls correct endpoint with stationId filter", () => {
      const params = { stationId: "station-123" };
      portalResults.list(params);
      expect(mockUseAuthQuery).toHaveBeenCalledWith(
        queryKeys.portalResults.list(params),
        "/api/portal-results?stationId=station-123",
        undefined,
        undefined
      );
    });
  });

  describe("pin", () => {
    it("sends POST to /api/portal-results", () => {
      portalResults.pin();
      expect(mockUseAuthMutation).toHaveBeenCalledWith({
        url: "/api/portal-results",
      });
    });
  });

  describe("rename", () => {
    it("sends PATCH to /api/portal-results/:id", () => {
      portalResults.rename("result-123");
      expect(mockUseAuthMutation).toHaveBeenCalledWith({
        url: "/api/portal-results/result-123",
        method: "PATCH",
      });
    });
  });

  describe("remove", () => {
    it("sends DELETE to /api/portal-results/:id", () => {
      portalResults.remove("result-123");
      expect(mockUseAuthMutation).toHaveBeenCalledWith({
        url: "/api/portal-results/result-123",
        method: "DELETE",
      });
    });
  });
});
