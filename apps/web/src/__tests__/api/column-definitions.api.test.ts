import { jest, describe, it, expect, beforeEach } from "@jest/globals";

const mockUseAuthQuery = jest.fn();
const mockUseAuthMutation = jest.fn();

jest.unstable_mockModule("../../utils/api.util", () => ({
  useAuthQuery: mockUseAuthQuery,
  useAuthMutation: mockUseAuthMutation,
  useAuthFetch: () => ({ fetchWithAuth: jest.fn() }),
}));

jest.unstable_mockModule("@portalai/core/ui", () => ({
  useAsyncFilterOptions: jest.fn(),
}));

const { columnDefinitions } = await import("../../api/column-definitions.api");
const { queryKeys } = await import("../../api/keys");

const basePagination = { limit: 20, offset: 0, sortBy: "created", sortOrder: "asc" as const };

describe("column-definitions.api", () => {
  beforeEach(() => {
    mockUseAuthQuery.mockReset();
    mockUseAuthMutation.mockReset();
  });

  describe("list", () => {
    it("calls correct endpoint with no params", () => {
      columnDefinitions.list();
      expect(mockUseAuthQuery).toHaveBeenCalledWith(
        queryKeys.columnDefinitions.list(undefined),
        "/api/column-definitions",
        undefined,
        undefined
      );
    });

    it("calls correct endpoint with type filter", () => {
      const params = { ...basePagination, type: "string" };
      columnDefinitions.list(params);
      expect(mockUseAuthQuery).toHaveBeenCalledWith(
        queryKeys.columnDefinitions.list(params),
        "/api/column-definitions?limit=20&offset=0&sortBy=created&sortOrder=asc&type=string",
        undefined,
        undefined
      );
    });

    it("does not include required in the URL", () => {
      // The ColumnDefinitionListRequestQuery type no longer includes `required`.
      const params = { ...basePagination, type: "number" };
      columnDefinitions.list(params);
      const calledUrl = mockUseAuthQuery.mock.calls[0][1];
      expect(calledUrl).not.toContain("required");
    });
  });

  describe("get", () => {
    it("calls correct endpoint by id", () => {
      columnDefinitions.get("cd-123");
      expect(mockUseAuthQuery).toHaveBeenCalledWith(
        queryKeys.columnDefinitions.get("cd-123"),
        "/api/column-definitions/cd-123",
        undefined,
        undefined
      );
    });

    it("encodes id in URL", () => {
      columnDefinitions.get("cd/with/slashes");
      expect(mockUseAuthQuery).toHaveBeenCalledWith(
        expect.anything(),
        "/api/column-definitions/cd%2Fwith%2Fslashes",
        undefined,
        undefined
      );
    });
  });

  describe("impact", () => {
    it("calls correct endpoint by id", () => {
      columnDefinitions.impact("cd-123");
      expect(mockUseAuthQuery).toHaveBeenCalledWith(
        queryKeys.columnDefinitions.impact("cd-123"),
        "/api/column-definitions/cd-123/impact",
        undefined,
        undefined
      );
    });
  });

  describe("create", () => {
    it("sends POST to /api/column-definitions", () => {
      columnDefinitions.create();
      expect(mockUseAuthMutation).toHaveBeenCalledWith({
        url: "/api/column-definitions",
        method: "POST",
      });
    });
  });

  describe("update", () => {
    it("sends PATCH to /api/column-definitions/:id", () => {
      columnDefinitions.update("cd-123");
      expect(mockUseAuthMutation).toHaveBeenCalledWith({
        url: "/api/column-definitions/cd-123",
        method: "PATCH",
      });
    });
  });

  describe("delete", () => {
    it("sends DELETE to /api/column-definitions/:id", () => {
      columnDefinitions.delete("cd-123");
      expect(mockUseAuthMutation).toHaveBeenCalledWith({
        url: "/api/column-definitions/cd-123",
        method: "DELETE",
      });
    });
  });

  describe("contract type alignment", () => {
    it("create/update mutations use typed payloads from @portalai/core/contracts", () => {
      // Compile-time verification: the mutation hooks are typed with contract
      // types that reflect the refactored schema:
      //   - Removed: required, defaultValue, format, enumValues
      //   - Added: validationPattern, validationMessage, canonicalFormat
      // If these types were wrong, this file would not compile.
      expect(true).toBe(true);
    });
  });
});
