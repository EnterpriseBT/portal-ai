import { jest, describe, it, expect, beforeEach } from "@jest/globals";

const mockUseAuthQuery = jest.fn();
const mockUseAuthMutation = jest.fn();

jest.unstable_mockModule("../../utils/api.util", () => ({
  useAuthQuery: mockUseAuthQuery,
  useAuthMutation: mockUseAuthMutation,
}));

const { portals } = await import("../../api/portals.api");
const { queryKeys } = await import("../../api/keys");

describe("portals.api", () => {
  beforeEach(() => {
    mockUseAuthQuery.mockReset();
    mockUseAuthMutation.mockReset();
  });

  describe("list", () => {
    it("calls correct endpoint with no params", () => {
      portals.list();
      expect(mockUseAuthQuery).toHaveBeenCalledWith(
        queryKeys.portals.list(undefined),
        "/api/portals",
        undefined,
        undefined
      );
    });

    it("calls correct endpoint with stationId param", () => {
      const params = { limit: 20, offset: 0, sortBy: "created", sortOrder: "asc" as const, stationId: "station-123" };
      portals.list(params);
      expect(mockUseAuthQuery).toHaveBeenCalledWith(
        queryKeys.portals.list(params),
        "/api/portals?limit=20&offset=0&sortBy=created&sortOrder=asc&stationId=station-123",
        undefined,
        undefined
      );
    });
  });

  describe("get", () => {
    it("calls correct endpoint by id", () => {
      portals.get("portal-123");
      expect(mockUseAuthQuery).toHaveBeenCalledWith(
        queryKeys.portals.get("portal-123"),
        "/api/portals/portal-123",
        undefined,
        undefined
      );
    });
  });

  describe("create", () => {
    it("sends POST to /api/portals", () => {
      portals.create();
      expect(mockUseAuthMutation).toHaveBeenCalledWith({
        url: "/api/portals",
      });
    });
  });

  describe("sendMessage", () => {
    it("sends POST with message to portal messages endpoint", () => {
      portals.sendMessage("portal-123");
      expect(mockUseAuthMutation).toHaveBeenCalledWith({
        url: "/api/portals/portal-123/messages",
      });
    });
  });

  describe("rename", () => {
    it("sends PATCH to portal endpoint", () => {
      portals.rename("portal-123");
      expect(mockUseAuthMutation).toHaveBeenCalledWith({
        url: "/api/portals/portal-123",
        method: "PATCH",
      });
    });
  });

  describe("remove", () => {
    it("sends DELETE to portal endpoint", () => {
      portals.remove("portal-123");
      expect(mockUseAuthMutation).toHaveBeenCalledWith({
        url: "/api/portals/portal-123",
        method: "DELETE",
      });
    });
  });

  describe("resetMessages", () => {
    it("sends DELETE to portal messages endpoint", () => {
      portals.resetMessages("portal-123");
      expect(mockUseAuthMutation).toHaveBeenCalledWith({
        url: "/api/portals/portal-123/messages",
        method: "DELETE",
      });
    });
  });

  describe("touch", () => {
    it("sends PATCH to portal endpoint", () => {
      portals.touch("portal-123");
      expect(mockUseAuthMutation).toHaveBeenCalledWith({
        url: "/api/portals/portal-123",
        method: "PATCH",
      });
    });
  });
});
