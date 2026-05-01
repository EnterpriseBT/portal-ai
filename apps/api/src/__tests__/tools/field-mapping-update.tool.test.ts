/* eslint-disable @typescript-eslint/no-explicit-any -- escape hatches for drizzle ORM and JSONB typings; values are validated upstream. */
/* global AbortController */
import { jest, describe, it, expect, beforeEach } from "@jest/globals";

const mockAssertStationScope = jest
  .fn<() => Promise<void>>()
  .mockResolvedValue(undefined);
const mockAssertWriteCapability = jest
  .fn<() => Promise<void>>()
  .mockResolvedValue(undefined);
const mockFindById = jest.fn<() => Promise<unknown>>().mockResolvedValue({
  id: "fm-1",
  connectorEntityId: "ce-1",
  organizationId: "org-1",
  sourceField: "Name",
  columnDefinitionId: "cd-1",
  isPrimaryKey: false,
});
const mockUpdate = jest
  .fn<() => Promise<unknown>>()
  .mockResolvedValue({ id: "fm-1" });
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
      fieldMappings: { findById: mockFindById, update: mockUpdate },
    },
  },
}));
jest.unstable_mockModule("../../services/analytics.service.js", () => ({
  AnalyticsService: { applyFieldMappingUpdateMany: jest.fn() },
}));
jest.unstable_mockModule("../../db/repositories/base.repository.js", () => ({
  Repository: { transaction: mockTransaction },
}));

const { FieldMappingUpdateTool } =
  await import("../../tools/field-mapping-update.tool.js");

beforeEach(() => {
  jest.clearAllMocks();
});

type Item = {
  fieldMappingId: string;
  sourceField?: string;
  isPrimaryKey?: boolean;
  normalizedKey?: string;
  required?: boolean;
  defaultValue?: string | null;
  format?: string | null;
  enumValues?: string[] | null;
};
const exec = (input: { items: Item[] }) =>
  new FieldMappingUpdateTool().build("station-1", "org-1", "user-1").execute!(
    input,
    { toolCallId: "t", messages: [], abortSignal: new AbortController().signal }
  );

describe("FieldMappingUpdateTool", () => {
  it("single-item regression — updates sourceField", async () => {
    const result: any = await exec({
      items: [{ fieldMappingId: "fm-1", sourceField: "Full Name" }],
    });
    expect(result.success).toBe(true);
    expect(result.count).toBe(1);
    expect(result.items).toHaveLength(1);
    expect(mockUpdate).toHaveBeenCalledWith(
      "fm-1",
      expect.objectContaining({ sourceField: "Full Name" }),
      "mock-tx"
    );
  });

  it("bulk update — 3 mappings updated in transaction", async () => {
    mockFindById
      .mockResolvedValueOnce({
        id: "fm-1",
        connectorEntityId: "ce-1",
        organizationId: "org-1",
        sourceField: "A",
        columnDefinitionId: "cd-1",
        isPrimaryKey: false,
      })
      .mockResolvedValueOnce({
        id: "fm-2",
        connectorEntityId: "ce-1",
        organizationId: "org-1",
        sourceField: "B",
        columnDefinitionId: "cd-2",
        isPrimaryKey: false,
      })
      .mockResolvedValueOnce({
        id: "fm-3",
        connectorEntityId: "ce-1",
        organizationId: "org-1",
        sourceField: "C",
        columnDefinitionId: "cd-3",
        isPrimaryKey: false,
      });

    const result: any = await exec({
      items: [
        { fieldMappingId: "fm-1", sourceField: "A2" },
        { fieldMappingId: "fm-2", isPrimaryKey: true },
        { fieldMappingId: "fm-3", required: true },
      ],
    });

    expect(result.success).toBe(true);
    expect(result.count).toBe(3);
    expect(mockAssertStationScope).toHaveBeenCalledTimes(1); // grouped by ce-1
    expect(mockUpdate).toHaveBeenCalledTimes(3);
    expect(mockTransaction).toHaveBeenCalledTimes(1);
  });

  it("validation failure — mapping not found", async () => {
    mockFindById.mockResolvedValueOnce(null);

    const result: any = await exec({
      items: [{ fieldMappingId: "fm-missing", sourceField: "X" }],
    });

    expect(result.success).toBe(false);
    expect(result.failures[0].error).toContain("not found");
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it("validation failure — wrong organization", async () => {
    mockFindById.mockResolvedValueOnce({
      id: "fm-1",
      connectorEntityId: "ce-1",
      organizationId: "other-org",
      sourceField: "A",
    });

    const result: any = await exec({
      items: [{ fieldMappingId: "fm-1", sourceField: "X" }],
    });

    expect(result.success).toBe(false);
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it("scope check failure blocks all items", async () => {
    mockAssertStationScope.mockRejectedValueOnce(new Error("Scope fail"));

    const result: any = await exec({
      items: [{ fieldMappingId: "fm-1", sourceField: "X" }],
    });

    expect(result.success).toBe(false);
    expect(mockUpdate).not.toHaveBeenCalled();
  });
});
