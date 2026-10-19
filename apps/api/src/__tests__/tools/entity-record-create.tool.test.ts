/* eslint-disable @typescript-eslint/no-explicit-any -- escape hatches for drizzle ORM and JSONB typings; values are validated upstream. */
/* global AbortController */
import { jest, describe, it, expect, beforeEach } from "@jest/globals";

const mockAssertStationScope = jest
  .fn<(...a: unknown[]) => Promise<void>>()
  .mockResolvedValue(undefined);
const mockAssertWriteCapability = jest
  .fn<(...a: unknown[]) => Promise<void>>()
  .mockResolvedValue(undefined);
const MAPPINGS = [{ normalizedKey: "name" }];
const mockLoadMappings = jest
  .fn<(...a: unknown[]) => Promise<unknown[]>>()
  .mockResolvedValue(MAPPINGS);
// #760: the tool normalizes through the shared write model.
const mockNormalize = jest
  .fn<(...a: unknown[]) => unknown[]>()
  .mockImplementation((_mappings, rows) =>
    (rows as unknown[]).map(() => ({
      normalizedData: { name: "Jane" },
      validationErrors: null,
      isValid: true,
    }))
  );
const mockCreateMany = jest
  .fn<(...a: unknown[]) => Promise<unknown[]>>()
  .mockImplementation((...args: unknown[]) => {
    const items = args[0] as any[];
    return Promise.resolve(
      items.map((_: unknown, i: number) => ({ id: `rec-${i + 1}` }))
    );
  });
const mockTransaction = jest
  .fn<(fn: (tx: unknown) => Promise<unknown>) => Promise<unknown>>()
  .mockImplementation((fn) => fn("mock-tx"));

jest.unstable_mockModule("../../utils/resolve-capabilities.util.js", () => ({
  assertStationScope: mockAssertStationScope,
  assertWriteCapability: mockAssertWriteCapability,
}));
jest.unstable_mockModule("../../services/normalization.service.js", () => ({
  NormalizationService: { loadMappings: mockLoadMappings },
}));
jest.unstable_mockModule("../../services/record-write.service.js", () => ({
  RecordWriteService: { normalize: mockNormalize },
}));
const mockFindEntityById = jest
  .fn<(...a: unknown[]) => Promise<unknown>>()
  .mockResolvedValue({ id: "ce-1", key: "customers", label: "My Entity" });

const mockWideTableUpsertMany = jest
  .fn<(...a: unknown[]) => Promise<unknown>>()
  .mockResolvedValue({ repaired: 0, rejected: [] });
const mockStatementGet = jest
  .fn<(...a: unknown[]) => Promise<{ columns: unknown[] }>>()
  .mockResolvedValue({ columns: [] });

const mockCountMappings = jest
  .fn<(ids: string[]) => Promise<number>>()
  .mockResolvedValue(1);

jest.unstable_mockModule("../../services/db.service.js", () => ({
  DbService: {
    repository: {
      entityRecords: { createMany: mockCreateMany },
      connectorEntities: { findById: mockFindEntityById },
      wideTable: { upsertMany: mockWideTableUpsertMany },
      fieldMappings: { countByConnectorEntityIds: mockCountMappings },
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

jest.unstable_mockModule(
  "../../services/wide-table-projection.util.js",
  () => ({
    projectToWideRow: jest.fn(() => ({})),
    buildMappingsForProjection: jest.fn(() => new Map()),
  })
);

const { EntityRecordCreateTool } =
  await import("../../tools/entity-record-create.tool.js");

beforeEach(() => {
  jest.clearAllMocks();
});

type ItemInput = {
  connectorEntityId: string;
  sourceId?: string;
  data: Record<string, unknown>;
};
const exec = (input: { items: ItemInput[] }, portalId: string | null = null) =>
  new EntityRecordCreateTool().build("station-1", "org-1", "user-1", portalId)
    .execute!(input, {
    toolCallId: "t",
    messages: [],
    abortSignal: new AbortController().signal,
  });

describe("EntityRecordCreateTool", () => {
  it("#757: a geometry the wide table refuses fails the call, naming the field", async () => {
    mockStatementGet.mockResolvedValueOnce({
      columns: [{ columnName: "c_geom", normalizedKey: "geom" }],
    });
    mockWideTableUpsertMany.mockResolvedValueOnce({
      repaired: 0,
      rejected: [
        {
          sourceId: "s-1",
          code: "GEOMETRY_INVALID_ON_IMPORT",
          fields: ["geom"],
          problems: [{ code: "GEOMETRY_INVALID_ON_IMPORT", fields: ["geom"] }],
          reason: "GEOMETRY_INVALID_ON_IMPORT: geometry was unparseable",
        },
      ],
    });

    const result: any = await exec({
      items: [{ connectorEntityId: "ce-1", data: { geom: "" } }],
    });

    expect(result.success).toBeUndefined();
    expect(result.error).toMatch(/"geom"/);
    // The throw happens inside the transaction callback, so it rolls back.
    expect(mockTransaction).toHaveBeenCalledTimes(1);
    await expect(
      mockTransaction.mock.results[0].value as Promise<unknown>
    ).rejects.toThrow(/"geom"/);
  });

  it("#757: a multi-item refusal names the items, not their sourceIds", async () => {
    mockNormalize.mockReturnValueOnce([
      { normalizedData: { geom: null }, validationErrors: null, isValid: true },
      { normalizedData: { geom: "" }, validationErrors: null, isValid: true },
    ]);
    mockCreateMany.mockImplementationOnce((...args: unknown[]) =>
      Promise.resolve(
        (args[0] as any[]).map((m) => ({
          id: m.id,
          connectorEntityId: m.connectorEntityId,
          sourceId: m.sourceId,
        }))
      )
    );
    mockStatementGet.mockResolvedValueOnce({
      columns: [{ columnName: "c_geom", normalizedKey: "geom" }],
    });
    mockWideTableUpsertMany.mockResolvedValueOnce({
      repaired: 0,
      rejected: [
        {
          sourceId: "src-b",
          code: "GEOMETRY_INVALID_ON_IMPORT",
          fields: ["geom"],
          problems: [{ code: "GEOMETRY_INVALID_ON_IMPORT", fields: ["geom"] }],
          reason: "GEOMETRY_INVALID_ON_IMPORT: geometry was unparseable",
        },
      ],
    });

    const result: any = await exec({
      items: [
        { connectorEntityId: "ce-1", sourceId: "src-a", data: { geom: null } },
        { connectorEntityId: "ce-1", sourceId: "src-b", data: { geom: "" } },
      ],
    });

    expect(result.error).toMatch(
      /^1 record carries a geometry that can't be written; nothing was written: items\[1\]\. Field "geom"/
    );
  });

  it("#760: a geometry the normalizer can't parse is refused naming the item", async () => {
    await exec({
      items: [
        { connectorEntityId: "ce-1", sourceId: "src-a", data: {} },
        { connectorEntityId: "ce-1", sourceId: "src-b", data: {} },
      ],
    });
    const opts = mockNormalize.mock.calls[0][2] as {
      batch: boolean;
      describe: (id: string) => string;
    };
    expect(opts.batch).toBe(true);
    expect(opts.describe("src-b")).toBe("items[1]");
  });

  it("#757: a clean mirror write succeeds", async () => {
    mockStatementGet.mockResolvedValueOnce({
      columns: [{ columnName: "c_geom", normalizedKey: "geom" }],
    });
    const result: any = await exec({
      items: [{ connectorEntityId: "ce-1", data: { Name: "Jane" } }],
    });
    expect(result.success).toBe(true);
    expect(mockWideTableUpsertMany).toHaveBeenCalledTimes(1);
  });

  it("single-item regression — { items: [single] } produces same result", async () => {
    const result: any = await exec({
      items: [{ connectorEntityId: "ce-1", data: { Name: "Jane" } }],
    });
    expect(result.success).toBe(true);
    expect(result.count).toBe(1);
    expect(result.items).toHaveLength(1);
    expect(result.items[0].entityId).toBe("rec-1");
    expect(mockLoadMappings).toHaveBeenCalledWith("ce-1");
    expect(mockNormalize).toHaveBeenCalledWith(
      MAPPINGS,
      [{ sourceId: expect.any(String), input: { Name: "Jane" } }],
      expect.objectContaining({ batch: false })
    );
    expect(mockCreateMany).toHaveBeenCalledWith(
      [
        expect.objectContaining({
          connectorEntityId: "ce-1",
          origin: "portal",
          checksum: "manual",
        }),
      ],
      "mock-tx"
    );
  });

  // #641: the portal session that ran the tool is recorded as provenance;
  // the prompting user still owns the record.
  it("records the portal session as provenance, owned by the caller (#641)", async () => {
    await exec(
      { items: [{ connectorEntityId: "ce-1", data: { Name: "Jane" } }] },
      "portal-1"
    );
    expect(mockCreateMany).toHaveBeenCalledWith(
      [
        expect.objectContaining({
          createdBy: "user-1",
          origin: "portal",
          sourcePortalId: "portal-1",
        }),
      ],
      "mock-tx"
    );
  });

  it("bulk create — 3 items persisted in single createMany call", async () => {
    mockNormalize.mockReturnValueOnce([
      { normalizedData: { name: "A" }, validationErrors: null, isValid: true },
      { normalizedData: { name: "B" }, validationErrors: null, isValid: true },
      { normalizedData: { name: "C" }, validationErrors: null, isValid: true },
    ]);
    mockCreateMany.mockResolvedValueOnce([
      { id: "r-1" },
      { id: "r-2" },
      { id: "r-3" },
    ]);

    const result: any = await exec({
      items: [
        { connectorEntityId: "ce-1", data: { Name: "A" } },
        { connectorEntityId: "ce-1", data: { Name: "B" } },
        { connectorEntityId: "ce-1", data: { Name: "C" } },
      ],
    });

    expect(result.success).toBe(true);
    expect(result.count).toBe(3);
    expect(result.items).toHaveLength(3);
    expect(mockAssertStationScope).toHaveBeenCalledTimes(1);
    expect(mockAssertWriteCapability).toHaveBeenCalledTimes(1);
    expect(mockNormalize).toHaveBeenCalledTimes(1);
    expect(
      (mockNormalize.mock.calls[0][1] as Array<{ input: unknown }>).map(
        (r) => r.input
      )
    ).toEqual([{ Name: "A" }, { Name: "B" }, { Name: "C" }]);
    expect(mockCreateMany).toHaveBeenCalledTimes(1);
    expect((mockCreateMany.mock.calls[0] as unknown[])[0]).toHaveLength(3);
  });

  it("bulk create — mixed connectorEntityIds groups correctly", async () => {
    mockNormalize
      .mockReturnValueOnce([
        {
          normalizedData: { name: "A" },
          validationErrors: null,
          isValid: true,
        },
        {
          normalizedData: { name: "B" },
          validationErrors: null,
          isValid: true,
        },
      ])
      .mockReturnValueOnce([
        {
          normalizedData: { name: "C" },
          validationErrors: null,
          isValid: true,
        },
      ]);
    mockFindEntityById
      .mockResolvedValueOnce({
        id: "ce-1",
        key: "customers",
        label: "Customers",
      })
      .mockResolvedValueOnce({ id: "ce-2", key: "orders", label: "Orders" });
    mockCreateMany.mockResolvedValueOnce([
      { id: "r-1" },
      { id: "r-2" },
      { id: "r-3" },
    ]);

    const result: any = await exec({
      items: [
        { connectorEntityId: "ce-1", data: { Name: "A" } },
        { connectorEntityId: "ce-1", data: { Name: "B" } },
        { connectorEntityId: "ce-2", data: { Name: "C" } },
      ],
    });

    expect(result.success).toBe(true);
    expect(result.count).toBe(3);
    expect(mockAssertStationScope).toHaveBeenCalledTimes(2);
    expect(mockAssertWriteCapability).toHaveBeenCalledTimes(2);
    expect(mockNormalize).toHaveBeenCalledTimes(2);
  });

  it("validation failure — scope check fails, nothing written", async () => {
    mockAssertStationScope.mockRejectedValueOnce(new Error("Scope violation"));

    const result: any = await exec({
      items: [
        { connectorEntityId: "ce-1", data: { Name: "A" } },
        { connectorEntityId: "ce-1", data: { Name: "B" } },
      ],
    });

    expect(result.success).toBe(false);
    expect(result.failures).toBeDefined();
    expect(mockCreateMany).not.toHaveBeenCalled();
  });

  it("refuses records for an entity with no field mappings (#154)", async () => {
    mockCountMappings.mockResolvedValueOnce(0);

    const result: any = await exec({
      items: [{ connectorEntityId: "ce-unmapped", data: { Name: "Ghost" } }],
    });

    expect(result.success).toBe(false);
    expect(result.failures).toHaveLength(1);
    expect(result.failures[0].error).toMatch(/no field mappings/i);
    expect(mockCreateMany).not.toHaveBeenCalled();
  });

  it("auto-generates sourceId per item when omitted", async () => {
    mockNormalize.mockReturnValueOnce([
      { normalizedData: { a: 1 }, validationErrors: null, isValid: true },
      { normalizedData: { b: 2 }, validationErrors: null, isValid: true },
    ]);
    mockCreateMany.mockResolvedValueOnce([{ id: "r-1" }, { id: "r-2" }]);

    await exec({
      items: [
        { connectorEntityId: "ce-1", data: { a: 1 } },
        { connectorEntityId: "ce-1", data: { b: 2 } },
      ],
    });

    const models = (mockCreateMany.mock.calls[0] as unknown[])[0] as any[];
    expect(models[0].sourceId).toMatch(/^[0-9a-f-]{36}$/);
    expect(models[1].sourceId).toMatch(/^[0-9a-f-]{36}$/);
    expect(models[0].sourceId).not.toBe(models[1].sourceId);
  });

  it("uses provided sourceId when given", async () => {
    await exec({
      items: [{ connectorEntityId: "ce-1", data: {}, sourceId: "custom-id" }],
    });
    const models = (mockCreateMany.mock.calls[0] as unknown[])[0] as any[];
    expect(models[0].sourceId).toBe("custom-id");
  });

  it("sets origin portal and checksum manual on all items", async () => {
    mockNormalize.mockReturnValueOnce([
      { normalizedData: {}, validationErrors: null, isValid: true },
      { normalizedData: {}, validationErrors: null, isValid: true },
    ]);
    mockCreateMany.mockResolvedValueOnce([{ id: "r-1" }, { id: "r-2" }]);

    await exec({
      items: [
        { connectorEntityId: "ce-1", data: {} },
        { connectorEntityId: "ce-1", data: {} },
      ],
    });

    const models = (mockCreateMany.mock.calls[0] as unknown[])[0] as any[];
    for (const m of models) {
      expect(m.origin).toBe("portal");
      expect(m.checksum).toBe("manual");
    }
  });
});
