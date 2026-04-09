/* global AbortController */
import { jest, describe, it, expect, beforeEach } from "@jest/globals";

const mockFindById = jest.fn<any>().mockResolvedValue({ id: "cd-1", key: "email", type: "string", organizationId: "org-1", label: "Email", description: null });
const mockUpdate = jest.fn<any>().mockResolvedValue({ id: "cd-1" });
const mockTransaction = jest.fn<(fn: (tx: unknown) => Promise<unknown>) => Promise<unknown>>()
  .mockImplementation((fn) => fn("mock-tx"));

jest.unstable_mockModule("../../services/db.service.js", () => ({
  DbService: { repository: { columnDefinitions: { findById: mockFindById, update: mockUpdate } } },
}));
jest.unstable_mockModule("../../services/analytics.service.js", () => ({
  AnalyticsService: { applyColumnDefinitionUpdateMany: jest.fn() },
}));
jest.unstable_mockModule("../../db/repositories/base.repository.js", () => ({
  Repository: { transaction: mockTransaction },
}));

const { ColumnDefinitionUpdateTool } = await import("../../tools/column-definition-update.tool.js");

beforeEach(() => { jest.clearAllMocks(); });

type Item = { columnDefinitionId: string; label?: string; description?: string | null };
const exec = (input: { items: Item[] }) =>
  new ColumnDefinitionUpdateTool().build("station-1", "org-1", "user-1")
    .execute!(input, { toolCallId: "t", messages: [], abortSignal: new AbortController().signal });

describe("ColumnDefinitionUpdateTool", () => {
  it("single-item regression — updates label", async () => {
    const result: any = await exec({ items: [{ columnDefinitionId: "cd-1", label: "New Label" }] });
    expect(result.success).toBe(true);
    expect(result.count).toBe(1);
    expect(result.items).toHaveLength(1);
    expect(mockUpdate).toHaveBeenCalledWith("cd-1", expect.objectContaining({ label: "New Label" }), "mock-tx");
  });

  it("bulk update — 3 items updated in transaction", async () => {
    mockFindById
      .mockResolvedValueOnce({ id: "cd-1", organizationId: "org-1", key: "a", label: "A" })
      .mockResolvedValueOnce({ id: "cd-2", organizationId: "org-1", key: "b", label: "B" })
      .mockResolvedValueOnce({ id: "cd-3", organizationId: "org-1", key: "c", label: "C" });

    const result: any = await exec({
      items: [
        { columnDefinitionId: "cd-1", label: "A2" },
        { columnDefinitionId: "cd-2", label: "B2" },
        { columnDefinitionId: "cd-3", description: "New desc" },
      ],
    });

    expect(result.success).toBe(true);
    expect(result.count).toBe(3);
    expect(mockUpdate).toHaveBeenCalledTimes(3);
    expect(mockTransaction).toHaveBeenCalledTimes(1);
  });

  it("validation failure — column definition not found", async () => {
    mockFindById
      .mockResolvedValueOnce({ id: "cd-1", organizationId: "org-1" })
      .mockResolvedValueOnce(null);

    const result: any = await exec({
      items: [
        { columnDefinitionId: "cd-1", label: "X" },
        { columnDefinitionId: "cd-missing", label: "Y" },
      ],
    });

    expect(result.success).toBe(false);
    expect(result.failures).toBeDefined();
    expect(result.failures.some((f: any) => f.index === 1)).toBe(true);
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it("validation failure — wrong organization", async () => {
    mockFindById.mockResolvedValueOnce({ id: "cd-1", organizationId: "other-org" });

    const result: any = await exec({
      items: [{ columnDefinitionId: "cd-1", label: "X" }],
    });

    expect(result.success).toBe(false);
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it("does not accept key or type changes (schema rejects)", () => {
    const tool = new ColumnDefinitionUpdateTool();
    const itemShape = (tool.schema.shape as any).items.element.shape;
    expect(itemShape.key).toBeUndefined();
    expect(itemShape.type).toBeUndefined();
  });
});
