import { jest, describe, it, expect, beforeEach } from "@jest/globals";

const mockUseAuthQuery = jest.fn();
const mockUseAuthMutation = jest.fn();

jest.unstable_mockModule("../../utils/api.util", () => ({
  useAuthQuery: mockUseAuthQuery,
  useAuthMutation: mockUseAuthMutation,
}));

const { connectorInstanceLayoutPlans } = await import(
  "../../api/connector-instance-layout-plans.api"
);
const { queryKeys } = await import("../../api/keys");

describe("connectorInstanceLayoutPlans.api", () => {
  beforeEach(() => {
    mockUseAuthQuery.mockReset();
    mockUseAuthMutation.mockReset();
  });

  describe("interpret", () => {
    it("mutates POST to the interpret endpoint under the connector instance", () => {
      connectorInstanceLayoutPlans.interpret("ci_123");
      expect(mockUseAuthMutation).toHaveBeenCalledWith({
        url: "/api/connector-instances/ci_123/layout-plan/interpret",
      });
    });

    it("URL-encodes the connector instance id", () => {
      connectorInstanceLayoutPlans.interpret("ci with/slash");
      expect(mockUseAuthMutation).toHaveBeenCalledWith({
        url: "/api/connector-instances/ci%20with%2Fslash/layout-plan/interpret",
      });
    });
  });

  describe("getCurrent", () => {
    it("queries the layout-plan endpoint and threads ?include through buildUrl", () => {
      connectorInstanceLayoutPlans.getCurrent("ci_123", {
        include: "interpretationTrace",
      });
      expect(mockUseAuthQuery).toHaveBeenCalledWith(
        queryKeys.connectorInstanceLayoutPlans.detail("ci_123"),
        "/api/connector-instances/ci_123/layout-plan?include=interpretationTrace",
        undefined,
        undefined
      );
    });

    it("omits the query string when no params are given", () => {
      connectorInstanceLayoutPlans.getCurrent("ci_123");
      expect(mockUseAuthQuery).toHaveBeenCalledWith(
        queryKeys.connectorInstanceLayoutPlans.detail("ci_123"),
        "/api/connector-instances/ci_123/layout-plan",
        undefined,
        undefined
      );
    });
  });

  describe("patch", () => {
    it("mutates PATCH against the /:planId subpath", () => {
      connectorInstanceLayoutPlans.patch("ci_123", "plan_abc");
      expect(mockUseAuthMutation).toHaveBeenCalledWith({
        url: "/api/connector-instances/ci_123/layout-plan/plan_abc",
        method: "PATCH",
      });
    });
  });

  describe("commit", () => {
    it("mutates POST against the /:planId/commit subpath", () => {
      connectorInstanceLayoutPlans.commit("ci_123", "plan_abc");
      expect(mockUseAuthMutation).toHaveBeenCalledWith({
        url: "/api/connector-instances/ci_123/layout-plan/plan_abc/commit",
      });
    });
  });
});

describe("queryKeys.connectorInstanceLayoutPlans", () => {
  it("has the expected root shape", () => {
    expect(queryKeys.connectorInstanceLayoutPlans.root).toEqual([
      "connectorInstanceLayoutPlans",
    ]);
  });

  it("derives detail() from root + id", () => {
    expect(queryKeys.connectorInstanceLayoutPlans.detail("ci_123")).toEqual([
      "connectorInstanceLayoutPlans",
      "detail",
      "ci_123",
    ]);
  });
});
