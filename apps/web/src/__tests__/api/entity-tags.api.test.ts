import { jest, describe, it, expect, beforeEach } from "@jest/globals";

const mockUseAuthQuery = jest.fn();
const mockUseAuthMutation = jest.fn();
const mockUseAuthFetch = jest.fn();

jest.unstable_mockModule("../../utils/api.util", () => ({
  useAuthQuery: mockUseAuthQuery,
  useAuthMutation: mockUseAuthMutation,
  useAuthFetch: mockUseAuthFetch,
}));

const { entityTags } = await import("../../api/entity-tags.api");

describe("entity-tags.api", () => {
  beforeEach(() => {
    mockUseAuthMutation.mockReset();
  });

  // #689: a 403 refetches tags so the gates re-render.
  it.each([
    ["create", () => entityTags.create()],
    ["update", () => entityTags.update("t-1")],
    ["delete", () => entityTags.delete("t-1")],
  ])("%s invalidates entityTags.root on a 403", (_name, call) => {
    call();
    const config = mockUseAuthMutation.mock.calls[0][0] as {
      onPermissionDenied: { invalidate: (vars: unknown) => unknown };
    };
    expect(config.onPermissionDenied.invalidate(undefined)).toEqual([
      ["entityTags"],
    ]);
  });
});
