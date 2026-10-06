import { jest, describe, it, expect, beforeEach } from "@jest/globals";

const mockUseAuthQuery = jest.fn();
const mockUseAuthMutation = jest.fn();

jest.unstable_mockModule("../../utils/api.util", () => ({
  useAuthQuery: mockUseAuthQuery,
  useAuthMutation: mockUseAuthMutation,
}));

const { toolpacks } = await import("../../api/toolpacks.api");
const { queryKeys } = await import("../../api/keys");

type MutationConfig = {
  onPermissionDenied?: { invalidate: (vars: unknown) => unknown[] };
};
const configOf = () =>
  mockUseAuthMutation.mock.calls[0][0] as unknown as MutationConfig;

// #688/#711: a 403 on a toolpack mutation means the caller's access changed
// under an open page, so the toolpacks re-fetch and Edit, Delete, Refresh and
// Rotate stop being offered.
describe("toolpacks.api onPermissionDenied", () => {
  beforeEach(() => {
    mockUseAuthMutation.mockReset();
  });

  it.each([
    ["update", () => toolpacks.update("tp-1")],
    ["remove", () => toolpacks.remove("tp-1")],
    ["refresh", () => toolpacks.refresh()],
    ["rotateSigningSecret", () => toolpacks.rotateSigningSecret("tp-1")],
  ])("%s invalidates toolpacks.root on a permission denial", (_, call) => {
    call();
    expect(configOf().onPermissionDenied?.invalidate(undefined)).toEqual([
      queryKeys.toolpacks.root,
    ]);
  });
});
