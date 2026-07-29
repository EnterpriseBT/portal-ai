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
    it("sends DELETE and takes the id from the mutation variables (#286)", () => {
      portalResults.remove();

      const calls = mockUseAuthMutation.mock.calls;
      const config = calls[calls.length - 1][0] as {
        url: (vars: { id: string }) => string;
        method: string;
        body: (vars: { id: string }) => unknown;
      };

      expect(config.method).toBe("DELETE");
      // Bound at call time, not hook-creation time: PortalMessage renders
      // many blocks whose pinned ids differ.
      expect(config.url({ id: "result-123" })).toBe(
        "/api/portal-results/result-123"
      );
      expect(config.body({ id: "result-123" })).toBeUndefined();
    });

    it("url-encodes the id", () => {
      portalResults.remove();

      const calls = mockUseAuthMutation.mock.calls;
      const config = calls[calls.length - 1][0] as {
        url: (vars: { id: string }) => string;
      };

      expect(config.url({ id: "a b/c" })).toBe("/api/portal-results/a%20b%2Fc");
    });
  });
});
