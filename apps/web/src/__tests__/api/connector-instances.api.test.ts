import { jest, describe, it, expect, beforeEach } from "@jest/globals";

const mockUseAuthQuery = jest.fn();
const mockUseAuthMutation = jest.fn();
const mockUseAuthFetch = jest.fn();

jest.unstable_mockModule("../../utils/api.util", () => ({
  useAuthQuery: mockUseAuthQuery,
  useAuthMutation: mockUseAuthMutation,
  useAuthFetch: mockUseAuthFetch,
}));

jest.unstable_mockModule("@portalai/core/ui", () => ({
  useInfiniteFilterOptions: jest.fn(),
}));

const { connectorInstances } = await import(
  "../../api/connector-instances.api"
);

describe("connector-instances.api", () => {
  beforeEach(() => {
    mockUseAuthMutation.mockReset();
  });

  describe("sync", () => {
    it("sends POST to /sync with the encoded id", () => {
      connectorInstances.sync("ci-1");
      expect(mockUseAuthMutation).toHaveBeenCalledWith({
        url: "/api/connector-instances/ci-1/sync",
        method: "POST",
      });
    });

    it("encodes the id in the URL", () => {
      connectorInstances.sync("ci/with/slashes");
      expect(mockUseAuthMutation).toHaveBeenCalledWith({
        url: "/api/connector-instances/ci%2Fwith%2Fslashes/sync",
        method: "POST",
      });
    });
  });
});
