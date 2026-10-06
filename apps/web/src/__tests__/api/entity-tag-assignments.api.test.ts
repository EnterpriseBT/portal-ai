import { jest, describe, it, expect, beforeEach } from "@jest/globals";

const mockUseAuthQuery = jest.fn();
const mockUseAuthMutation = jest.fn();

jest.unstable_mockModule("../../utils/api.util", () => ({
  useAuthQuery: mockUseAuthQuery,
  useAuthMutation: mockUseAuthMutation,
}));

const { entityTagAssignments } =
  await import("../../api/entity-tag-assignments.api");

type Config = {
  url: string | ((vars: { assignmentId: string }) => string);
  method: string;
  body?: (vars: unknown) => unknown;
  onPermissionDenied: { invalidate: (vars: unknown) => unknown };
};

const lastConfig = () => mockUseAuthMutation.mock.calls[0][0] as Config;

describe("entity-tag-assignments.api", () => {
  beforeEach(() => {
    mockUseAuthMutation.mockReset();
  });

  it("assign POSTs to the entity's tags", () => {
    entityTagAssignments.assign("ce-1");
    expect(lastConfig().url).toBe("/api/connector-entities/ce-1/tags");
    expect(lastConfig().method).toBe("POST");
  });

  // #689: unassign goes through the SDK helper (it used to hand-roll a fetch).
  it("unassign DELETEs the assignment, with no body", () => {
    entityTagAssignments.unassign("ce-1");
    const config = lastConfig();
    expect(config.method).toBe("DELETE");
    expect(
      typeof config.url === "function" && config.url({ assignmentId: "a/1" })
    ).toBe("/api/connector-entities/ce-1/tags/a%2F1");
    expect(config.body?.({ assignmentId: "a/1" })).toBeUndefined();
  });

  it.each([
    ["assign", () => entityTagAssignments.assign("ce-1")],
    ["unassign", () => entityTagAssignments.unassign("ce-1")],
  ])("%s refetches the entity and its tags on a 403", (_name, call) => {
    call();
    expect(lastConfig().onPermissionDenied.invalidate(undefined)).toEqual([
      ["connectorEntities"],
      ["entityTagAssignments"],
    ]);
  });
});
