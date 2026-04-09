import { jest, describe, it, expect, beforeEach } from "@jest/globals";

const mockUseAuthQuery = jest.fn();
const mockUseAuthMutation = jest.fn();

jest.unstable_mockModule("../../utils/api.util", () => ({
  useAuthQuery: mockUseAuthQuery,
  useAuthMutation: mockUseAuthMutation,
}));

const { entityRecords } = await import("../../api/entity-records.api");
const { queryKeys } = await import("../../api/keys");

const basePagination = { limit: 20, offset: 0, sortBy: "created", sortOrder: "asc" as const };

describe("entity-records.api", () => {
  beforeEach(() => {
    mockUseAuthQuery.mockReset();
    mockUseAuthMutation.mockReset();
  });

  describe("list", () => {
    it("calls correct endpoint with no params", () => {
      entityRecords.list("ce-1");
      expect(mockUseAuthQuery).toHaveBeenCalledWith(
        queryKeys.entityRecords.list("ce-1", undefined),
        "/api/connector-entities/ce-1/records",
        undefined,
        undefined
      );
    });

    it("calls correct endpoint with pagination params", () => {
      const params = { ...basePagination };
      entityRecords.list("ce-1", params);
      expect(mockUseAuthQuery).toHaveBeenCalledWith(
        queryKeys.entityRecords.list("ce-1", params),
        "/api/connector-entities/ce-1/records?limit=20&offset=0&sortBy=created&sortOrder=asc",
        undefined,
        undefined
      );
    });

    it("includes isValid=true filter when provided", () => {
      const params = { ...basePagination, isValid: "true" as const };
      entityRecords.list("ce-1", params);
      const calledUrl = mockUseAuthQuery.mock.calls[0][1] as string;
      expect(calledUrl).toContain("isValid=true");
    });

    it("includes isValid=false filter when provided", () => {
      const params = { ...basePagination, isValid: "false" as const };
      entityRecords.list("ce-1", params);
      const calledUrl = mockUseAuthQuery.mock.calls[0][1] as string;
      expect(calledUrl).toContain("isValid=false");
    });

    it("does not include isValid when not provided", () => {
      entityRecords.list("ce-1");
      const calledUrl = mockUseAuthQuery.mock.calls[0][1] as string;
      expect(calledUrl).not.toContain("isValid");
    });

    it("encodes connectorEntityId in URL", () => {
      entityRecords.list("ce/with/slashes");
      expect(mockUseAuthQuery).toHaveBeenCalledWith(
        expect.anything(),
        "/api/connector-entities/ce%2Fwith%2Fslashes/records",
        undefined,
        undefined
      );
    });
  });

  describe("count", () => {
    it("calls correct endpoint", () => {
      entityRecords.count("ce-1");
      expect(mockUseAuthQuery).toHaveBeenCalledWith(
        queryKeys.entityRecords.count("ce-1"),
        "/api/connector-entities/ce-1/records/count",
        undefined,
        undefined
      );
    });
  });

  describe("get", () => {
    it("calls correct endpoint by entity and record id", () => {
      entityRecords.get("ce-1", "rec-1");
      expect(mockUseAuthQuery).toHaveBeenCalledWith(
        queryKeys.entityRecords.get("ce-1", "rec-1"),
        "/api/connector-entities/ce-1/records/rec-1",
        undefined,
        undefined
      );
    });
  });

  describe("create", () => {
    it("sends POST to records endpoint", () => {
      entityRecords.create("ce-1");
      expect(mockUseAuthMutation).toHaveBeenCalledWith({
        url: "/api/connector-entities/ce-1/records",
      });
    });
  });

  describe("import", () => {
    it("sends POST to records/import endpoint", () => {
      entityRecords.import("ce-1");
      expect(mockUseAuthMutation).toHaveBeenCalledWith({
        url: "/api/connector-entities/ce-1/records/import",
      });
    });
  });

  describe("sync", () => {
    it("sends POST to records/sync endpoint", () => {
      entityRecords.sync("ce-1");
      expect(mockUseAuthMutation).toHaveBeenCalledWith({
        url: "/api/connector-entities/ce-1/records/sync",
      });
    });
  });

  describe("update", () => {
    it("sends PATCH to records/:recordId endpoint", () => {
      entityRecords.update("ce-1", "rec-1");
      expect(mockUseAuthMutation).toHaveBeenCalledWith({
        url: "/api/connector-entities/ce-1/records/rec-1",
        method: "PATCH",
      });
    });
  });

  describe("clear", () => {
    it("sends DELETE to records endpoint", () => {
      entityRecords.clear("ce-1");
      expect(mockUseAuthMutation).toHaveBeenCalledWith({
        url: "/api/connector-entities/ce-1/records",
        method: "DELETE",
      });
    });
  });

  describe("delete", () => {
    it("sends DELETE to records/:recordId endpoint", () => {
      entityRecords.delete("ce-1", "rec-1");
      expect(mockUseAuthMutation).toHaveBeenCalledWith({
        url: "/api/connector-entities/ce-1/records/rec-1",
        method: "DELETE",
      });
    });
  });

  describe("revalidate", () => {
    it("sends POST to records/revalidate endpoint", () => {
      entityRecords.revalidate("ce-1");
      expect(mockUseAuthMutation).toHaveBeenCalledWith({
        url: "/api/connector-entities/ce-1/records/revalidate",
      });
    });

    it("encodes connectorEntityId in URL", () => {
      entityRecords.revalidate("ce/with/slashes");
      expect(mockUseAuthMutation).toHaveBeenCalledWith({
        url: "/api/connector-entities/ce%2Fwith%2Fslashes/records/revalidate",
      });
    });
  });
});
