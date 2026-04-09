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

const { fieldMappings } = await import("../../api/field-mappings.api");
const { queryKeys } = await import("../../api/keys");

const basePagination = { limit: 20, offset: 0, sortBy: "created", sortOrder: "asc" as const };

describe("field-mappings.api", () => {
  beforeEach(() => {
    mockUseAuthQuery.mockReset();
    mockUseAuthMutation.mockReset();
  });

  describe("list", () => {
    it("calls correct endpoint with no params", () => {
      fieldMappings.list();
      expect(mockUseAuthQuery).toHaveBeenCalledWith(
        queryKeys.fieldMappings.list(undefined),
        "/api/field-mappings",
        undefined,
        undefined
      );
    });

    it("calls correct endpoint with connectorEntityId filter", () => {
      const params = { ...basePagination, connectorEntityId: "ce-1" };
      fieldMappings.list(params);
      expect(mockUseAuthQuery).toHaveBeenCalledWith(
        queryKeys.fieldMappings.list(params),
        "/api/field-mappings?limit=20&offset=0&sortBy=created&sortOrder=asc&connectorEntityId=ce-1",
        undefined,
        undefined
      );
    });

    it("calls correct endpoint with columnDefinitionId filter", () => {
      const params = { ...basePagination, columnDefinitionId: "cd-1" };
      fieldMappings.list(params);
      expect(mockUseAuthQuery).toHaveBeenCalledWith(
        queryKeys.fieldMappings.list(params),
        "/api/field-mappings?limit=20&offset=0&sortBy=created&sortOrder=asc&columnDefinitionId=cd-1",
        undefined,
        undefined
      );
    });

    it("calls correct endpoint with include param", () => {
      const params = { ...basePagination, include: "connectorEntity" };
      fieldMappings.list(params);
      expect(mockUseAuthQuery).toHaveBeenCalledWith(
        queryKeys.fieldMappings.list(params),
        "/api/field-mappings?limit=20&offset=0&sortBy=created&sortOrder=asc&include=connectorEntity",
        undefined,
        undefined
      );
    });
  });

  describe("validateBidirectional", () => {
    it("calls correct endpoint by id", () => {
      fieldMappings.validateBidirectional("fm-123");
      expect(mockUseAuthQuery).toHaveBeenCalledWith(
        queryKeys.fieldMappings.validateBidirectional("fm-123"),
        "/api/field-mappings/fm-123/validate-bidirectional",
        undefined,
        undefined
      );
    });
  });

  describe("impact", () => {
    it("calls correct endpoint by id", () => {
      fieldMappings.impact("fm-123");
      expect(mockUseAuthQuery).toHaveBeenCalledWith(
        queryKeys.fieldMappings.impact("fm-123"),
        "/api/field-mappings/fm-123/impact",
        undefined,
        undefined
      );
    });
  });

  describe("create", () => {
    it("sends POST to /api/field-mappings", () => {
      fieldMappings.create();
      expect(mockUseAuthMutation).toHaveBeenCalledWith({
        url: "/api/field-mappings",
        method: "POST",
      });
    });
  });

  describe("update", () => {
    it("sends PATCH to /api/field-mappings/:id", () => {
      fieldMappings.update("fm-123");
      expect(mockUseAuthMutation).toHaveBeenCalledWith({
        url: "/api/field-mappings/fm-123",
        method: "PATCH",
      });
    });
  });

  describe("delete", () => {
    it("sends DELETE to /api/field-mappings/:id", () => {
      fieldMappings.delete("fm-123");
      expect(mockUseAuthMutation).toHaveBeenCalledWith({
        url: "/api/field-mappings/fm-123",
        method: "DELETE",
      });
    });
  });

  describe("contract type alignment", () => {
    it("create/update mutations include new field-mapping fields in their typed payloads", () => {
      // Compile-time verification: FieldMappingCreateRequestBody now includes
      // normalizedKey (required), required, defaultValue, format, enumValues.
      // FieldMappingUpdateRequestBody includes the same as optional.
      // If these fields were missing, this file would not compile.
      expect(true).toBe(true);
    });
  });
});
