import { jest, describe, it, expect, beforeEach } from "@jest/globals";

const mockUseAuthQuery = jest.fn();
const mockUseAuthMutation = jest.fn();

jest.unstable_mockModule("../../utils/api.util", () => ({
  useAuthQuery: mockUseAuthQuery,
  useAuthMutation: mockUseAuthMutation,
}));

const { curatedViews } = await import("../../api/curated-views.api");
const { queryKeys } = await import("../../api/keys");

type MutationConfig = {
  onPermissionDenied?: { invalidate: (vars: unknown) => unknown[] };
};
const configOf = () =>
  mockUseAuthMutation.mock.calls[0][0] as unknown as MutationConfig;

// #688: a 403 on a view mutation means the caller's capabilities changed, so
// the views re-fetch and their affordances re-render.
describe("curated-views.api onPermissionDenied (#688)", () => {
  beforeEach(() => {
    mockUseAuthMutation.mockReset();
  });

  it.each([
    ["update", () => curatedViews.update("cv-1")],
    ["delete", () => curatedViews.delete("cv-1")],
  ])("%s invalidates curatedViews.root on a permission denial", (_, call) => {
    call();
    expect(configOf().onPermissionDenied?.invalidate(undefined)).toEqual([
      queryKeys.curatedViews.root,
    ]);
  });
});
