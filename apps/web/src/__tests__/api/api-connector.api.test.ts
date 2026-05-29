import { jest, describe, it, expect, beforeEach } from "@jest/globals";

const mockUseAuthQuery = jest.fn();
const mockUseAuthMutation = jest.fn();

jest.unstable_mockModule("../../utils/api.util", () => ({
  useAuthQuery: mockUseAuthQuery,
  useAuthMutation: mockUseAuthMutation,
}));

const { apiConnector } = await import("../../api/api-connector.api");

describe("apiConnector.endpoints.suggestTransform", () => {
  beforeEach(() => {
    mockUseAuthMutation.mockReset();
  });

  it("registers a POST mutation against /api/connector-instances/suggest-transform", () => {
    apiConnector.endpoints.suggestTransform();
    expect(mockUseAuthMutation).toHaveBeenCalledTimes(1);
    expect(mockUseAuthMutation).toHaveBeenCalledWith({
      url: "/api/connector-instances/suggest-transform",
      method: "POST",
    });
  });

  it("returns whatever useAuthMutation returns (the standard hook handle)", () => {
    const handle = {
      mutateAsync: jest.fn(),
      isPending: false,
      error: null,
    };
    mockUseAuthMutation.mockReturnValueOnce(handle);
    expect(apiConnector.endpoints.suggestTransform()).toBe(handle);
  });
});
