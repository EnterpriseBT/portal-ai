import { jest, describe, it, expect, beforeEach } from "@jest/globals";

import type { TagTargetType } from "@portalai/core/models";

const mockUseAuthQuery = jest.fn();
const mockUseAuthMutation = jest.fn();

jest.unstable_mockModule("../../utils/api.util", () => ({
  WRITE_TIMEOUT_MS: 30_000,
  LONG_WRITE_TIMEOUT_MS: 300_000,
  useAuthQuery: mockUseAuthQuery,
  useAuthMutation: mockUseAuthMutation,
}));

const { tagAssignments, TAG_TARGET_PATH } =
  await import("../../api/tag-assignments.api");

type Config = {
  url: string | ((vars: { assignmentId: string }) => string);
  method: string;
  body?: (vars: unknown) => unknown;
  onPermissionDenied: { invalidate: (vars: unknown) => unknown };
};

const lastConfig = () => mockUseAuthMutation.mock.calls[0][0] as Config;

const TARGETS: [TagTargetType, string, string[]][] = [
  ["entity", "connector-entities", ["connectorEntities"]],
  ["station", "stations", ["stations"]],
  ["pin", "portal-results", ["portalResults"]],
  ["connector_instance", "connector-instances", ["connectorInstances"]],
  ["curated_view", "curated-views", ["curatedViews"]],
];

describe("tag-assignments.api (#1070)", () => {
  beforeEach(() => {
    mockUseAuthMutation.mockReset();
    mockUseAuthQuery.mockReset();
  });

  it("names a path for every taggable type", () => {
    expect(TAG_TARGET_PATH).toEqual(
      Object.fromEntries(TARGETS.map(([type, path]) => [type, path]))
    );
  });

  it.each(TARGETS)("lists the tags on a %s", (type, path) => {
    tagAssignments.list({ type, id: "x-1" });
    expect(mockUseAuthQuery.mock.calls[0]![0]).toEqual([
      "tagAssignments",
      type,
      "x-1",
    ]);
    expect(mockUseAuthQuery.mock.calls[0]![1]).toBe(`/api/${path}/x-1/tags`);
  });

  it.each(TARGETS)("assign POSTs to a %s's tags", (type, path) => {
    tagAssignments.assign({ type, id: "x-1" });
    expect(lastConfig().url).toBe(`/api/${path}/x-1/tags`);
    expect(lastConfig().method).toBe("POST");
  });

  it("unassign DELETEs the assignment, with no body", () => {
    tagAssignments.unassign({ type: "station", id: "st-1" });
    const config = lastConfig();
    expect(config.method).toBe("DELETE");
    expect(
      typeof config.url === "function" && config.url({ assignmentId: "a/1" })
    ).toBe("/api/stations/st-1/tags/a%2F1");
    expect(config.body?.({ assignmentId: "a/1" })).toBeUndefined();
  });

  it.each(TARGETS)(
    "assign and unassign refetch a %s and its tags on a 403",
    (type, _path, root) => {
      tagAssignments.assign({ type, id: "x-1" });
      tagAssignments.unassign({ type, id: "x-1" });
      for (const [config] of mockUseAuthMutation.mock.calls as [Config][]) {
        expect(config.onPermissionDenied.invalidate(undefined)).toEqual([
          root,
          ["tagAssignments"],
        ]);
      }
    }
  );
});
