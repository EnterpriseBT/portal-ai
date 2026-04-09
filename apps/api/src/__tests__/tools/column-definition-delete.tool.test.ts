/* global AbortController */
import { jest, describe, it, expect, beforeEach } from "@jest/globals";

const mockValidateDelete = jest.fn<any>().mockResolvedValue(undefined);
const mockFindById = jest.fn<any>().mockResolvedValue({ id: "cd-1", organizationId: "org-1", key: "email", label: "Email" });
const mockSoftDelete = jest.fn<any>().mockResolvedValue({ id: "cd-1" });
const mockTransaction = jest.fn<(fn: (tx: unknown) => Promise<unknown>) => Promise<unknown>>()
  .mockImplementation((fn) => fn("mock-tx"));

jest.unstable_mockModule("../../services/column-definition-validation.service.js", () => ({
  ColumnDefinitionValidationService: { validateDelete: mockValidateDelete },
}));
jest.unstable_mockModule("../../services/db.service.js", () => ({
  DbService: { repository: { columnDefinitions: { findById: mockFindById, softDelete: mockSoftDelete } } },
}));
jest.unstable_mockModule("../../services/analytics.service.js", () => ({
  AnalyticsService: { applyColumnDefinitionDeleteMany: jest.fn() },
}));
jest.unstable_mockModule("../../db/repositories/base.repository.js", () => ({
  Repository: { transaction: mockTransaction },
}));

const { ColumnDefinitionDeleteTool } = await import("../../tools/column-definition-delete.tool.js");

beforeEach(() => { jest.clearAllMocks(); });

type Item = { columnDefinitionId: string };
const exec = (input: { items: Item[] }) =>
  new ColumnDefinitionDeleteTool().build("station-1", "org-1", "user-1")
    .execute!(input, { toolCallId: "t", messages: [], abortSignal: new AbortController().signal });

describe("ColumnDefinitionDeleteTool", () => {
  it("single-item regression — deletes successfully", async () => {
    const result: any = await exec({ items: [{ columnDefinitionId: "cd-1" }] });
    expect(result.success).toBe(true);
    expect(result.count).toBe(1);
    expect(result.items).toHaveLength(1);
    expect(result.items[0].entityId).toBe("cd-1");
    expect(mockSoftDelete).toHaveBeenCalledWith("cd-1", "user-1", "mock-tx");
  });

  it("bulk delete — 3 items soft-deleted in transaction", async () => {
    mockFindById
      .mockResolvedValueOnce({ id: "cd-1", organizationId: "org-1", key: "a", label: "A" })
      .mockResolvedValueOnce({ id: "cd-2", organizationId: "org-1", key: "b", label: "B" })
      .mockResolvedValueOnce({ id: "cd-3", organizationId: "org-1", key: "c", label: "C" });

    const result: any = await exec({
      items: [
        { columnDefinitionId: "cd-1" },
        { columnDefinitionId: "cd-2" },
        { columnDefinitionId: "cd-3" },
      ],
    });

    expect(result.success).toBe(true);
    expect(result.count).toBe(3);
    expect(mockValidateDelete).toHaveBeenCalledTimes(3);
    expect(mockSoftDelete).toHaveBeenCalledTimes(3);
    expect(mockTransaction).toHaveBeenCalledTimes(1);
  });

  it("validation failure — field mappings reference one definition, nothing deleted", async () => {
    mockFindById
      .mockResolvedValueOnce({ id: "cd-1", organizationId: "org-1", key: "a", label: "A" })
      .mockResolvedValueOnce({ id: "cd-2", organizationId: "org-1", key: "b", label: "B" });
    mockValidateDelete
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error("Has dependencies"));

    const result: any = await exec({
      items: [
        { columnDefinitionId: "cd-1" },
        { columnDefinitionId: "cd-2" },
      ],
    });

    expect(result.success).toBe(false);
    expect(result.failures).toBeDefined();
    expect(result.failures.some((f: any) => f.index === 1)).toBe(true);
    expect(mockSoftDelete).not.toHaveBeenCalled();
  });

  it("validation failure — column definition not found", async () => {
    mockFindById.mockResolvedValueOnce(null);

    const result: any = await exec({ items: [{ columnDefinitionId: "cd-missing" }] });

    expect(result.success).toBe(false);
    expect(mockSoftDelete).not.toHaveBeenCalled();
  });

  it("validation failure — wrong organization", async () => {
    mockFindById.mockResolvedValueOnce({ id: "cd-1", organizationId: "other-org" });

    const result: any = await exec({ items: [{ columnDefinitionId: "cd-1" }] });

    expect(result.success).toBe(false);
    expect(mockSoftDelete).not.toHaveBeenCalled();
  });
});
