/* global AbortController */
import { jest, describe, it, expect, beforeEach } from "@jest/globals";

const mockUpsertByKey = jest.fn<any>().mockResolvedValue({ id: "cd-new" });
const mockFindByOrganizationId = jest.fn<any>().mockResolvedValue([]);
const mockTransaction = jest.fn<(fn: (tx: unknown) => Promise<unknown>) => Promise<unknown>>()
  .mockImplementation((fn) => fn("mock-tx"));

jest.unstable_mockModule("../../services/db.service.js", () => ({
  DbService: { repository: { columnDefinitions: { upsertByKey: mockUpsertByKey, findByOrganizationId: mockFindByOrganizationId } } },
}));
jest.unstable_mockModule("../../services/analytics.service.js", () => ({
  AnalyticsService: { applyColumnDefinitionInsertMany: jest.fn() },
}));
jest.unstable_mockModule("../../db/repositories/base.repository.js", () => ({
  Repository: { transaction: mockTransaction },
}));

const { ColumnDefinitionCreateTool } = await import("../../tools/column-definition-create.tool.js");

beforeEach(() => { jest.clearAllMocks(); });

type ColumnDataType = "string" | "number" | "boolean" | "date" | "datetime" | "enum" | "json" | "array" | "reference" | "reference-array";
type Item = { key: string; label: string; type: ColumnDataType; description?: string };
const exec = (input: { items: Item[] }) =>
  new ColumnDefinitionCreateTool().build("station-1", "org-1", "user-1")
    .execute!(input, { toolCallId: "t", messages: [], abortSignal: new AbortController().signal });

describe("ColumnDefinitionCreateTool", () => {
  it("single-item regression — creates one column definition", async () => {
    const result: any = await exec({ items: [{ key: "email", label: "Email", type: "string" }] });
    expect(result.success).toBe(true);
    expect(result.count).toBe(1);
    expect(result.created).toBe(1);
    expect(result.reused).toBe(0);
    expect(result.items).toHaveLength(1);
    expect(result.items[0].summary.status).toBe("created");
    expect(mockUpsertByKey).toHaveBeenCalledTimes(1);
  });

  it("bulk create — 3 new items upserted", async () => {
    mockUpsertByKey
      .mockResolvedValueOnce({ id: "cd-1" })
      .mockResolvedValueOnce({ id: "cd-2" })
      .mockResolvedValueOnce({ id: "cd-3" });

    const result: any = await exec({
      items: [
        { key: "name", label: "Name", type: "string" },
        { key: "age", label: "Age", type: "number" },
        { key: "active", label: "Active", type: "boolean" },
      ],
    });

    expect(result.success).toBe(true);
    expect(result.count).toBe(3);
    expect(result.created).toBe(3);
    expect(result.reused).toBe(0);
    expect(mockUpsertByKey).toHaveBeenCalledTimes(3);
  });

  it("reuse — existing definition with matching key+type is not upserted", async () => {
    mockFindByOrganizationId.mockResolvedValueOnce([
      { id: "cd-existing", key: "revenue", type: "number", label: "Revenue", organizationId: "org-1" },
    ]);

    const result: any = await exec({
      items: [{ key: "revenue", label: "Revenue", type: "number" }],
    });

    expect(result.success).toBe(true);
    expect(result.count).toBe(1);
    expect(result.reused).toBe(1);
    expect(result.created).toBe(0);
    expect(result.items[0].entityId).toBe("cd-existing");
    expect(result.items[0].summary.status).toBe("reused");
    expect(mockUpsertByKey).not.toHaveBeenCalled();
  });

  it("reuse with type mismatch — existing key but different type triggers upsert", async () => {
    mockFindByOrganizationId.mockResolvedValueOnce([
      { id: "cd-existing", key: "revenue", type: "string", label: "Revenue", organizationId: "org-1" },
    ]);
    mockUpsertByKey.mockResolvedValueOnce({ id: "cd-updated" });

    const result: any = await exec({
      items: [{ key: "revenue", label: "Revenue $", type: "number" }],
    });

    expect(result.success).toBe(true);
    expect(result.created).toBe(1);
    expect(result.reused).toBe(0);
    expect(result.items[0].summary.status).toBe("created");
    expect(mockUpsertByKey).toHaveBeenCalledTimes(1);
  });

  it("within-batch dedup — duplicate keys collapsed, last occurrence wins", async () => {
    mockUpsertByKey.mockResolvedValueOnce({ id: "cd-final" });

    const result: any = await exec({
      items: [
        { key: "cost", label: "Cost v1", type: "number" },
        { key: "cost", label: "Cost v2", type: "number" },
      ],
    });

    expect(result.success).toBe(true);
    expect(result.count).toBe(1);
    expect(mockUpsertByKey).toHaveBeenCalledTimes(1);
    expect(mockUpsertByKey).toHaveBeenCalledWith(
      expect.objectContaining({ label: "Cost v2" }),
      "mock-tx",
    );
  });

  it("mixed reuse and create in one batch", async () => {
    mockFindByOrganizationId.mockResolvedValueOnce([
      { id: "cd-existing", key: "name", type: "string", label: "Name", organizationId: "org-1" },
    ]);
    mockUpsertByKey.mockResolvedValueOnce({ id: "cd-new" });

    const result: any = await exec({
      items: [
        { key: "name", label: "Name", type: "string" },
        { key: "age", label: "Age", type: "number" },
      ],
    });

    expect(result.success).toBe(true);
    expect(result.count).toBe(2);
    expect(result.reused).toBe(1);
    expect(result.created).toBe(1);
    expect(mockUpsertByKey).toHaveBeenCalledTimes(1);
  });
});
