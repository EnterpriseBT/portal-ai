/* eslint-disable @typescript-eslint/no-explicit-any -- escape hatches for drizzle ORM and JSONB typings; values are validated upstream. */
/* global AbortController */
import { jest, describe, it, expect, beforeEach } from "@jest/globals";

const mockAssertStationScope = jest.fn<any>().mockResolvedValue(undefined);
const mockAssertWriteCapability = jest.fn<any>().mockResolvedValue(undefined);
const mockNormalizeMany = jest
  .fn<any>()
  .mockResolvedValue([
    { normalizedData: { name: "Bob" }, validationErrors: null, isValid: true },
  ]);
const mockFindRecordById = jest.fn<any>().mockResolvedValue({
  id: "rec-1",
  connectorEntityId: "ce-1",
  data: { Name: "Alice", Email: "alice@example.com" },
});
const mockUpdateMany = jest
  .fn<any>()
  .mockImplementation((payloads: any[]) =>
    Promise.resolve(payloads.map((p: any) => ({ id: p.id })))
  );
const mockTransaction = jest
  .fn<(fn: (tx: unknown) => Promise<unknown>) => Promise<unknown>>()
  .mockImplementation((fn) => fn("mock-tx"));

jest.unstable_mockModule("../../utils/resolve-capabilities.util.js", () => ({
  assertStationScope: mockAssertStationScope,
  assertWriteCapability: mockAssertWriteCapability,
}));
jest.unstable_mockModule("../../services/normalization.service.js", () => ({
  NormalizationService: { normalizeMany: mockNormalizeMany },
}));
const mockFindEntityById = jest
  .fn<any>()
  .mockResolvedValue({ id: "ce-1", key: "customers", label: "My Entity" });

const mockStatementGet = jest
  .fn<(...a: unknown[]) => Promise<{ columns: unknown[] }>>()
  .mockResolvedValue({ columns: [] });

const mockWideTableUpdatePartial = jest
  .fn<(...a: unknown[]) => Promise<unknown[]>>()
  .mockResolvedValue([]);

jest.unstable_mockModule("../../services/db.service.js", () => ({
  DbService: {
    repository: {
      entityRecords: {
        findById: mockFindRecordById,
        updateMany: mockUpdateMany,
      },
      connectorEntities: { findById: mockFindEntityById },
      wideTable: { updatePartial: mockWideTableUpdatePartial },
    },
  },
}));

jest.unstable_mockModule("../../db/repositories/base.repository.js", () => ({
  Repository: { transaction: mockTransaction },
}));

jest.unstable_mockModule(
  "../../services/wide-table-statement.cache.js",
  () => ({
    wideTableStatementCache: { get: mockStatementGet },
    WIDE_TABLE_METADATA_COLUMNS: [
      "entity_record_id",
      "organization_id",
      "synced_at",
      "is_valid",
      "source_id",
    ],
  })
);

const { ApiError } = await import("../../services/http.service.js");
const { ApiCode } = await import("../../constants/api-codes.constants.js");
const { EntityRecordUpdateTool } =
  await import("../../tools/entity-record-update.tool.js");

beforeEach(() => {
  jest.clearAllMocks();
});

type ItemInput = {
  connectorEntityId: string;
  entityRecordId: string;
  data: Record<string, unknown>;
};
const exec = (input: { items: ItemInput[] }) =>
  new EntityRecordUpdateTool().build("station-1", "user-1").execute!(input, {
    toolCallId: "t",
    messages: [],
    abortSignal: new AbortController().signal,
  });

describe("EntityRecordUpdateTool", () => {
  it("#757: a geometry the wide table refuses fails the call inside the transaction, naming the field", async () => {
    mockStatementGet.mockResolvedValueOnce({
      columns: [{ columnName: "c_geom", normalizedKey: "geom" }],
    });
    mockWideTableUpdatePartial.mockRejectedValueOnce(
      new ApiError(
        400,
        ApiCode.GEOMETRY_INVALID_ON_IMPORT,
        'Field "geom" is not a geometry that can be stored'
      )
    );

    const result: any = await exec({
      items: [
        {
          connectorEntityId: "ce-1",
          entityRecordId: "rec-1",
          data: { geom: "" },
        },
      ],
    });

    expect(result.success).toBeUndefined();
    expect(result.error).toMatch(/"geom"/);
    await expect(
      mockTransaction.mock.results[0].value as Promise<unknown>
    ).rejects.toThrow(/"geom"/);
  });

  it("#757: in a multi-item call the refusal names the item", async () => {
    mockNormalizeMany.mockResolvedValueOnce([
      { normalizedData: { geom: null }, validationErrors: null, isValid: true },
      { normalizedData: { geom: "" }, validationErrors: null, isValid: true },
    ]);
    mockStatementGet.mockResolvedValueOnce({
      columns: [{ columnName: "c_geom", normalizedKey: "geom" }],
    });
    mockWideTableUpdatePartial
      .mockResolvedValueOnce([])
      .mockRejectedValueOnce(
        new ApiError(
          400,
          ApiCode.GEOMETRY_INVALID_ON_IMPORT,
          'Field "geom" is not a geometry that can be stored'
        )
      );

    const result: any = await exec({
      items: [
        { connectorEntityId: "ce-1", entityRecordId: "rec-1", data: {} },
        {
          connectorEntityId: "ce-1",
          entityRecordId: "rec-2",
          data: { geom: "" },
        },
      ],
    });

    expect(result.error).toBe(
      'items[1] (record rec-2): Field "geom" is not a geometry that can be stored; nothing was written'
    );
  });

  it("single-item regression — { items: [single] } behaves as before", async () => {
    const result: any = await exec({
      items: [
        {
          connectorEntityId: "ce-1",
          entityRecordId: "rec-1",
          data: { Name: "Bob" },
        },
      ],
    });
    expect(result.success).toBe(true);
    expect(result.count).toBe(1);
    expect(result.items).toHaveLength(1);
    // Existing data { Name: "Alice", Email: "alice@example.com" } is merged
    // with partial update { Name: "Bob" } before normalization.
    expect(mockNormalizeMany).toHaveBeenCalledWith("ce-1", [
      { Name: "Bob", Email: "alice@example.com" },
    ]);
    expect(mockUpdateMany).toHaveBeenCalledTimes(1);
  });

  it("partial update — merges with existing data so untouched fields survive", async () => {
    mockFindRecordById.mockResolvedValueOnce({
      id: "rec-1",
      connectorEntityId: "ce-1",
      data: { id: "foo", name: "bar", desc: "fooz" },
    });
    mockNormalizeMany.mockResolvedValueOnce([
      {
        normalizedData: { id: "foo", name: "baz", desc: "fooz" },
        validationErrors: null,
        isValid: true,
      },
    ]);

    const result: any = await exec({
      items: [
        {
          connectorEntityId: "ce-1",
          entityRecordId: "rec-1",
          data: { name: "baz" },
        },
      ],
    });

    expect(result.success).toBe(true);
    // Normalization sees the merged object, not the partial payload
    expect(mockNormalizeMany).toHaveBeenCalledWith("ce-1", [
      { id: "foo", name: "baz", desc: "fooz" },
    ]);
    // The persisted `data` blob is the merged object, not the partial one
    const payloads = (mockUpdateMany.mock.calls[0] as any[])[0] as any[];
    expect(payloads[0].data.data).toEqual({
      id: "foo",
      name: "baz",
      desc: "fooz",
    });
    expect(payloads[0].data.normalizedData).toEqual({
      id: "foo",
      name: "baz",
      desc: "fooz",
    });
  });

  it("bulk update — 3 items updated in single transaction", async () => {
    mockFindRecordById
      .mockResolvedValueOnce({
        id: "rec-1",
        connectorEntityId: "ce-1",
        data: {},
      })
      .mockResolvedValueOnce({
        id: "rec-2",
        connectorEntityId: "ce-1",
        data: {},
      })
      .mockResolvedValueOnce({
        id: "rec-3",
        connectorEntityId: "ce-1",
        data: {},
      });
    mockNormalizeMany.mockResolvedValueOnce([
      { normalizedData: { a: 1 }, validationErrors: null, isValid: true },
      { normalizedData: { b: 2 }, validationErrors: null, isValid: true },
      { normalizedData: { c: 3 }, validationErrors: null, isValid: true },
    ]);

    const result: any = await exec({
      items: [
        { connectorEntityId: "ce-1", entityRecordId: "rec-1", data: { a: 1 } },
        { connectorEntityId: "ce-1", entityRecordId: "rec-2", data: { b: 2 } },
        { connectorEntityId: "ce-1", entityRecordId: "rec-3", data: { c: 3 } },
      ],
    });

    expect(result.success).toBe(true);
    expect(result.count).toBe(3);
    expect(mockAssertStationScope).toHaveBeenCalledTimes(1);
    expect(mockAssertWriteCapability).toHaveBeenCalledTimes(1);
    expect(mockUpdateMany).toHaveBeenCalledTimes(1);
    expect((mockUpdateMany.mock.calls[0] as any[])[0]).toHaveLength(3);
  });

  it("validation failure — record not found, nothing written", async () => {
    mockFindRecordById
      .mockResolvedValueOnce({ id: "rec-1", connectorEntityId: "ce-1" })
      .mockResolvedValueOnce(null);

    const result: any = await exec({
      items: [
        { connectorEntityId: "ce-1", entityRecordId: "rec-1", data: {} },
        { connectorEntityId: "ce-1", entityRecordId: "rec-missing", data: {} },
      ],
    });

    expect(result.success).toBe(false);
    expect(result.failures).toBeDefined();
    expect(result.failures.some((f: any) => f.index === 1)).toBe(true);
    expect(mockUpdateMany).not.toHaveBeenCalled();
  });

  it("validation failure — record belongs to wrong entity", async () => {
    mockFindRecordById.mockResolvedValueOnce({
      id: "rec-1",
      connectorEntityId: "ce-other",
    });

    const result: any = await exec({
      items: [{ connectorEntityId: "ce-1", entityRecordId: "rec-1", data: {} }],
    });

    expect(result.success).toBe(false);
    expect(result.failures[0].error).toContain("does not belong");
    expect(mockUpdateMany).not.toHaveBeenCalled();
  });

  it("validation failure — scope check fails", async () => {
    mockAssertStationScope.mockRejectedValueOnce(new Error("Scope fail"));

    const result: any = await exec({
      items: [{ connectorEntityId: "ce-1", entityRecordId: "rec-1", data: {} }],
    });

    expect(result.success).toBe(false);
    expect(mockUpdateMany).not.toHaveBeenCalled();
  });
});
