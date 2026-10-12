/* eslint-disable @typescript-eslint/no-explicit-any -- escape hatches for drizzle ORM and JSONB typings; values are validated upstream. */
/* global AbortController */
import { jest, describe, it, expect, beforeEach } from "@jest/globals";

const mockAssertStationScope = jest.fn<any>().mockResolvedValue(undefined);
const mockAssertWriteCapability = jest.fn<any>().mockResolvedValue(undefined);
const mockFindRecordById = jest.fn<any>().mockResolvedValue({
  id: "rec-1",
  connectorEntityId: "ce-1",
  data: { Name: "Alice" },
});
const mockPatchRecord = jest.fn<any>().mockResolvedValue({
  normalizedData: {},
  validationErrors: null,
  isValid: true,
});
const mockTransaction = jest
  .fn<(fn: (tx: unknown) => Promise<unknown>) => Promise<unknown>>()
  .mockImplementation((fn) => fn("mock-tx"));

jest.unstable_mockModule("../../utils/resolve-capabilities.util.js", () => ({
  assertStationScope: mockAssertStationScope,
  assertWriteCapability: mockAssertWriteCapability,
}));
jest.unstable_mockModule("../../services/record-write.service.js", () => ({
  RecordWriteService: { patchRecord: mockPatchRecord },
}));
jest.unstable_mockModule("../../services/db.service.js", () => ({
  DbService: {
    repository: { entityRecords: { findById: mockFindRecordById } },
  },
}));
jest.unstable_mockModule("../../db/repositories/base.repository.js", () => ({
  Repository: { transaction: mockTransaction },
}));

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

const geomRefusal = () =>
  new ApiError(
    400,
    ApiCode.GEOMETRY_INVALID_ON_IMPORT,
    'Field "geom" is not a geometry that can be stored'
  );

describe("EntityRecordUpdateTool", () => {
  it("#760: each item goes through the shared PATCH write, in one transaction", async () => {
    const result: any = await exec({
      items: [
        { connectorEntityId: "ce-1", entityRecordId: "rec-1", data: { a: 1 } },
        { connectorEntityId: "ce-1", entityRecordId: "rec-2", data: { b: 2 } },
      ],
    });

    expect(result.success).toBe(true);
    expect(result.count).toBe(2);
    expect(mockTransaction).toHaveBeenCalledTimes(1);
    expect(mockPatchRecord.mock.calls).toEqual([
      [
        "mock-tx",
        {
          connectorEntityId: "ce-1",
          recordId: "rec-1",
          patch: { normalizedData: { a: 1 } },
          userId: "user-1",
        },
      ],
      [
        "mock-tx",
        {
          connectorEntityId: "ce-1",
          recordId: "rec-2",
          patch: { normalizedData: { b: 2 } },
          userId: "user-1",
        },
      ],
    ]);
    expect(mockAssertStationScope).toHaveBeenCalledTimes(1);
    expect(mockAssertWriteCapability).toHaveBeenCalledTimes(1);
  });

  it("#757: a refused geometry fails the call inside the transaction, naming the field", async () => {
    mockPatchRecord.mockRejectedValueOnce(geomRefusal());

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
    mockPatchRecord
      .mockResolvedValueOnce({ isValid: true })
      .mockRejectedValueOnce(geomRefusal());

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
    expect(result.failures.some((f: any) => f.index === 1)).toBe(true);
    expect(mockPatchRecord).not.toHaveBeenCalled();
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
    expect(mockPatchRecord).not.toHaveBeenCalled();
  });

  it("validation failure — scope check fails", async () => {
    mockAssertStationScope.mockRejectedValueOnce(new Error("Scope fail"));

    const result: any = await exec({
      items: [{ connectorEntityId: "ce-1", entityRecordId: "rec-1", data: {} }],
    });

    expect(result.success).toBe(false);
    expect(mockPatchRecord).not.toHaveBeenCalled();
  });
});
