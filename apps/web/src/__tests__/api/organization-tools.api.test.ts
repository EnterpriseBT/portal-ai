import { jest, describe, it, expect, beforeEach } from "@jest/globals";

const mockUseAuthQuery = jest.fn();
const mockUseAuthMutation = jest.fn();

jest.unstable_mockModule("../../utils/api.util", () => ({
  useAuthQuery: mockUseAuthQuery,
  useAuthMutation: mockUseAuthMutation,
}));

const { organizationTools } = await import("../../api/organization-tools.api");
const { queryKeys } = await import("../../api/keys");

describe("organization-tools.api", () => {
  beforeEach(() => {
    mockUseAuthQuery.mockReset();
    mockUseAuthMutation.mockReset();
  });

  describe("list", () => {
    it("calls correct endpoint with no params", () => {
      organizationTools.list();
      expect(mockUseAuthQuery).toHaveBeenCalledWith(
        queryKeys.organizationTools.list(undefined),
        "/api/organization-tools",
        undefined,
        undefined
      );
    });

    it("calls correct endpoint with search param", () => {
      const params = { search: "my-tool" };
      organizationTools.list(params);
      expect(mockUseAuthQuery).toHaveBeenCalledWith(
        queryKeys.organizationTools.list(params),
        "/api/organization-tools?search=my-tool",
        undefined,
        undefined
      );
    });
  });

  describe("get", () => {
    it("calls correct endpoint by id", () => {
      organizationTools.get("tool-123");
      expect(mockUseAuthQuery).toHaveBeenCalledWith(
        queryKeys.organizationTools.get("tool-123"),
        "/api/organization-tools/tool-123",
        undefined,
        undefined
      );
    });
  });

  describe("create", () => {
    it("sends POST to /api/organization-tools", () => {
      organizationTools.create();
      expect(mockUseAuthMutation).toHaveBeenCalledWith({
        url: "/api/organization-tools",
      });
    });
  });

  describe("update", () => {
    it("sends PATCH to /api/organization-tools/:toolId", () => {
      organizationTools.update("tool-123");
      expect(mockUseAuthMutation).toHaveBeenCalledWith({
        url: "/api/organization-tools/tool-123",
        method: "PATCH",
      });
    });
  });

  describe("remove", () => {
    it("sends DELETE to /api/organization-tools/:toolId", () => {
      organizationTools.remove("tool-123");
      expect(mockUseAuthMutation).toHaveBeenCalledWith({
        url: "/api/organization-tools/tool-123",
        method: "DELETE",
      });
    });
  });
});
