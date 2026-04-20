/* global AbortController */
import { jest, describe, it, expect, beforeEach } from "@jest/globals";

const mockAssertStationScope = jest.fn<any>().mockResolvedValue(undefined);
const mockAssertWriteCapability = jest.fn<any>().mockResolvedValue(undefined);
const mockFindColDef = jest
  .fn<any>()
  .mockResolvedValue({
    id: "cd-1",
    organizationId: "org-1",
    label: "Column 1",
  });
const mockUpsert = jest.fn<any>().mockResolvedValue({ id: "fm-1" });
const mockTransaction = jest
  .fn<(fn: (tx: unknown) => Promise<unknown>) => Promise<unknown>>()
  .mockImplementation((fn) => fn("mock-tx"));

jest.unstable_mockModule("../../utils/resolve-capabilities.util.js", () => ({
  assertStationScope: mockAssertStationScope,
  assertWriteCapability: mockAssertWriteCapability,
}));
jest.unstable_mockModule("../../services/db.service.js", () => ({
  DbService: {
    repository: {
      columnDefinitions: { findById: mockFindColDef },
      fieldMappings: { upsertByEntityAndNormalizedKey: mockUpsert },
    },
  },
}));
jest.unstable_mockModule("../../services/analytics.service.js", () => ({
  AnalyticsService: { applyFieldMappingInsertMany: jest.fn() },
}));
jest.unstable_mockModule("../../db/repositories/base.repository.js", () => ({
  Repository: { transaction: mockTransaction },
}));

const { FieldMappingCreateTool } =
  await import("../../tools/field-mapping-create.tool.js");

beforeEach(() => {
  jest.clearAllMocks();
});

type Item = {
  connectorEntityId: string;
  columnDefinitionId: string;
  sourceField: string;
  normalizedKey: string;
  isPrimaryKey?: boolean;
  required?: boolean;
  defaultValue?: string | null;
  format?: string | null;
  enumValues?: string[] | null;
};
const exec = (input: { items: Item[] }) =>
  new FieldMappingCreateTool().build("station-1", "org-1", "user-1").execute!(
    input,
    { toolCallId: "t", messages: [], abortSignal: new AbortController().signal }
  );

describe("FieldMappingCreateTool", () => {
  it("single-item regression — upserts one mapping", async () => {
    const result: any = await exec({
      items: [
        {
          connectorEntityId: "ce-1",
          columnDefinitionId: "cd-1",
          sourceField: "Name",
          normalizedKey: "name",
        },
      ],
    });
    expect(result.success).toBe(true);
    expect(result.count).toBe(1);
    expect(result.items).toHaveLength(1);
    expect(mockAssertStationScope).toHaveBeenCalledTimes(1);
    expect(mockAssertWriteCapability).toHaveBeenCalledTimes(1);
    expect(mockUpsert).toHaveBeenCalledWith(
      expect.objectContaining({
        connectorEntityId: "ce-1",
        columnDefinitionId: "cd-1",
        sourceField: "Name",
        normalizedKey: "name",
      }),
      "mock-tx"
    );
  });

  it("bulk create — 3 mappings upserted in transaction", async () => {
    mockFindColDef
      .mockResolvedValueOnce({
        id: "cd-1",
        organizationId: "org-1",
        label: "C1",
      })
      .mockResolvedValueOnce({
        id: "cd-2",
        organizationId: "org-1",
        label: "C2",
      });
    mockUpsert
      .mockResolvedValueOnce({ id: "fm-1" })
      .mockResolvedValueOnce({ id: "fm-2" })
      .mockResolvedValueOnce({ id: "fm-3" });

    const result: any = await exec({
      items: [
        {
          connectorEntityId: "ce-1",
          columnDefinitionId: "cd-1",
          sourceField: "A",
          normalizedKey: "a",
        },
        {
          connectorEntityId: "ce-1",
          columnDefinitionId: "cd-1",
          sourceField: "B",
          normalizedKey: "b",
        },
        {
          connectorEntityId: "ce-1",
          columnDefinitionId: "cd-2",
          sourceField: "C",
          normalizedKey: "c",
        },
      ],
    });

    expect(result.success).toBe(true);
    expect(result.count).toBe(3);
    expect(mockAssertStationScope).toHaveBeenCalledTimes(1);
    expect(mockAssertWriteCapability).toHaveBeenCalledTimes(1);
    expect(mockUpsert).toHaveBeenCalledTimes(3);
    expect(mockTransaction).toHaveBeenCalledTimes(1);
  });

  it("validation failure — column definition not found for one item", async () => {
    mockFindColDef
      .mockResolvedValueOnce({
        id: "cd-1",
        organizationId: "org-1",
        label: "C1",
      })
      .mockResolvedValueOnce(null);

    const result: any = await exec({
      items: [
        {
          connectorEntityId: "ce-1",
          columnDefinitionId: "cd-1",
          sourceField: "A",
          normalizedKey: "a",
        },
        {
          connectorEntityId: "ce-1",
          columnDefinitionId: "cd-missing",
          sourceField: "B",
          normalizedKey: "b",
        },
      ],
    });

    expect(result.success).toBe(false);
    expect(result.failures.some((f: any) => f.index === 1)).toBe(true);
    expect(mockUpsert).not.toHaveBeenCalled();
  });

  it("validation failure — column definition belongs to different org", async () => {
    mockFindColDef.mockResolvedValueOnce({
      id: "cd-1",
      organizationId: "other-org",
      label: "C1",
    });

    const result: any = await exec({
      items: [
        {
          connectorEntityId: "ce-1",
          columnDefinitionId: "cd-1",
          sourceField: "A",
          normalizedKey: "a",
        },
      ],
    });

    expect(result.success).toBe(false);
    expect(mockUpsert).not.toHaveBeenCalled();
  });

  it("batch column definition lookup — deduplicates findById calls", async () => {
    mockFindColDef.mockResolvedValue({
      id: "cd-1",
      organizationId: "org-1",
      label: "C1",
    });
    mockUpsert.mockResolvedValue({ id: "fm-1" });

    await exec({
      items: [
        {
          connectorEntityId: "ce-1",
          columnDefinitionId: "cd-1",
          sourceField: "A",
          normalizedKey: "a",
        },
        {
          connectorEntityId: "ce-1",
          columnDefinitionId: "cd-1",
          sourceField: "B",
          normalizedKey: "b",
        },
        {
          connectorEntityId: "ce-1",
          columnDefinitionId: "cd-1",
          sourceField: "C",
          normalizedKey: "c",
        },
      ],
    });

    // Should look up cd-1 only once, not 3 times
    expect(mockFindColDef).toHaveBeenCalledTimes(1);
  });

  it("scope check failure blocks all items", async () => {
    mockAssertStationScope.mockRejectedValueOnce(new Error("Scope violation"));

    const result: any = await exec({
      items: [
        {
          connectorEntityId: "ce-1",
          columnDefinitionId: "cd-1",
          sourceField: "A",
          normalizedKey: "a",
        },
        {
          connectorEntityId: "ce-1",
          columnDefinitionId: "cd-1",
          sourceField: "B",
          normalizedKey: "b",
        },
      ],
    });

    expect(result.success).toBe(false);
    expect(result.failures).toHaveLength(2);
    expect(mockUpsert).not.toHaveBeenCalled();
  });
});
