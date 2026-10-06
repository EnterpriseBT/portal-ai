import { jest, describe, it, expect, beforeEach } from "@jest/globals";

const mockUseAuthQuery = jest.fn();
const mockUseAuthMutation = jest.fn();

jest.unstable_mockModule("../../utils/api.util", () => ({
  useAuthQuery: mockUseAuthQuery,
  useAuthMutation: mockUseAuthMutation,
}));

const { entityGroups } = await import("../../api/entity-groups.api");

type Config = {
  url: string | ((vars: Record<string, unknown>) => string);
  method: string;
  body?: (vars: Record<string, unknown>) => unknown;
  onPermissionDenied: { invalidate: (vars: unknown) => unknown };
};
const lastConfig = () => mockUseAuthMutation.mock.calls[0][0] as Config;
const resolveUrl = (config: Config, vars: Record<string, unknown>) =>
  typeof config.url === "function" ? config.url(vars) : config.url;

describe("entity-groups.api", () => {
  beforeEach(() => {
    mockUseAuthMutation.mockReset();
  });

  // #689: the member is a variable, so one hook serves every table row.
  it("updateMember PATCHes the member named by the variables, without it in the body", () => {
    entityGroups.updateMember("g-1");
    const config = lastConfig();
    expect(config.method).toBe("PATCH");
    expect(resolveUrl(config, { memberId: "m/1", isPrimary: true })).toBe(
      "/api/entity-groups/g-1/members/m%2F1"
    );
    expect(config.body?.({ memberId: "m/1", isPrimary: true })).toEqual({
      isPrimary: true,
    });
  });

  it("removeMember DELETEs the member named by the variables, with no body", () => {
    entityGroups.removeMember("g-1");
    const config = lastConfig();
    expect(config.method).toBe("DELETE");
    expect(resolveUrl(config, { memberId: "m-2" })).toBe(
      "/api/entity-groups/g-1/members/m-2"
    );
    expect(config.body?.({ memberId: "m-2" })).toBeUndefined();
  });

  it.each([
    ["create", () => entityGroups.create()],
    ["update", () => entityGroups.update("g-1")],
    ["delete", () => entityGroups.delete("g-1")],
    ["addMember", () => entityGroups.addMember("g-1")],
    ["updateMember", () => entityGroups.updateMember("g-1")],
    ["removeMember", () => entityGroups.removeMember("g-1")],
  ])("%s refetches entityGroups on a 403", (_name, call) => {
    call();
    expect(lastConfig().onPermissionDenied.invalidate(undefined)).toEqual([
      ["entityGroups"],
    ]);
  });
});
