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

const { connectorInstances } =
  await import("../../api/connector-instances.api");

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
        onPermissionDenied: { invalidate: expect.any(Function) },
      });
    });

    it("encodes the id in the URL", () => {
      connectorInstances.sync("ci/with/slashes");
      expect(mockUseAuthMutation).toHaveBeenCalledWith({
        url: "/api/connector-instances/ci%2Fwith%2Fslashes/sync",
        method: "POST",
        onPermissionDenied: { invalidate: expect.any(Function) },
      });
    });
  });

  // #689: a 403 on an instance write refetches the instance so the page's
  // gates re-render from fresh capabilities.
  describe("onPermissionDenied", () => {
    it.each([
      ["delete", () => connectorInstances.delete("ci-1")],
      ["rename", () => connectorInstances.rename("ci-1")],
      ["update", () => connectorInstances.update("ci-1")],
      ["sync", () => connectorInstances.sync("ci-1")],
      ["syncForInstance", () => connectorInstances.syncForInstance()],
    ])("%s invalidates connectorInstances.root", (_name, call) => {
      call();
      const config = mockUseAuthMutation.mock.calls[0][0] as {
        onPermissionDenied: { invalidate: (vars: unknown) => unknown };
      };
      expect(config.onPermissionDenied.invalidate(undefined)).toEqual([
        ["connectorInstances"],
      ]);
    });
  });
});
