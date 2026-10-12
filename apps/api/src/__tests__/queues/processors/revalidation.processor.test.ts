import { jest, describe, it, expect, beforeEach } from "@jest/globals";
import type { Job as BullJob } from "bullmq";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockFieldMappingsFindMany =
  jest.fn<(...args: unknown[]) => Promise<unknown[]>>();
const mockEntityRecordsFindByConnectorEntityId =
  jest.fn<(...args: unknown[]) => Promise<unknown[]>>();
const mockEntityRecordsBulkUpdateValidity = jest
  .fn<(...args: unknown[]) => Promise<number>>()
  .mockResolvedValue(0);
const mockNormalizeWithMappings = jest.fn<(...args: unknown[]) => unknown>();

const mockWideTableUpdateMany = jest
  .fn<(...a: unknown[]) => Promise<unknown[]>>()
  .mockResolvedValue([]);
const mockDbTransaction = jest
  .fn<(fn: (tx: unknown) => Promise<unknown>) => Promise<unknown>>()
  .mockImplementation((fn) => fn("mock-tx"));

jest.unstable_mockModule("../../../services/db.service.js", () => ({
  DbService: {
    transaction: mockDbTransaction,
    repository: {
      fieldMappings: { findMany: mockFieldMappingsFindMany },
      entityRecords: {
        findByConnectorEntityId: mockEntityRecordsFindByConnectorEntityId,
        bulkUpdateValidity: mockEntityRecordsBulkUpdateValidity,
      },
      wideTable: { updateMany: mockWideTableUpdateMany },
    },
  },
}));

jest.unstable_mockModule("../../../services/normalization.service.js", () => ({
  NormalizationService: {
    normalizeWithMappings: mockNormalizeWithMappings,
  },
}));

const mockLogger = {
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
};
jest.unstable_mockModule("../../../utils/logger.util.js", () => ({
  createLogger: () => mockLogger,
}));

jest.unstable_mockModule("../../../db/schema/index.js", () => ({
  fieldMappings: { connectorEntityId: "connectorEntityId" },
}));

// The processor invalidates the record-count cache on completion, which
// reaches getRedisClient() and opens a real ioredis connection nothing in a
// unit test closes — leaving the jest worker unable to exit gracefully (#377).
// Mock it so this stays a pure unit test, matching the sibling processor tests.
const mockCountCacheInvalidate = jest
  .fn<(...a: unknown[]) => Promise<void>>()
  .mockResolvedValue(undefined);
jest.unstable_mockModule(
  "../../../services/entity-record-count.cache.js",
  () => ({
    EntityRecordCountCache: { invalidate: mockCountCacheInvalidate },
  })
);

const { revalidationProcessor } =
  await import("../../../queues/processors/revalidation.processor.js");
const { RevalidationResultSchema } = await import("@portalai/core/models");

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createMockBullJob(data: Record<string, unknown> = {}): BullJob {
  return {
    data: {
      jobId: "job-001",
      type: "revalidation",
      connectorEntityId: "ce-1",
      organizationId: "org-1",
      ...data,
    },
    updateProgress: jest
      .fn<(progress: number) => Promise<void>>()
      .mockResolvedValue(undefined),
  } as unknown as BullJob;
}

function record(id: string, data: Record<string, unknown> = { name: "Alice" }) {
  return { id, data, normalizedData: data };
}

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

beforeEach(() => {
  jest.clearAllMocks();
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("revalidationProcessor", () => {
  it("returns empty result when entity has no records", async () => {
    mockFieldMappingsFindMany.mockResolvedValue([]);
    mockEntityRecordsFindByConnectorEntityId.mockResolvedValue([]);

    const bullJob = createMockBullJob();
    const result = await revalidationProcessor(bullJob);

    expect(result).toEqual({ total: 0, valid: 0, invalid: 0, errors: [] });
    expect(bullJob.updateProgress).toHaveBeenCalledWith(100);
  });

  it("re-normalizes records and returns valid/invalid counts", async () => {
    const mappings = [
      {
        id: "fm-1",
        sourceField: "name",
        normalizedKey: "name",
        columnDefinition: { key: "name", type: "string" },
      },
    ];
    mockFieldMappingsFindMany.mockResolvedValue(mappings);
    mockEntityRecordsFindByConnectorEntityId.mockResolvedValue([
      record("r-1", { name: "Alice" }),
      record("r-2", { name: "" }),
    ]);

    mockNormalizeWithMappings
      .mockReturnValueOnce({
        normalizedData: { name: "Alice" },
        validationErrors: null,
        isValid: true,
      })
      .mockReturnValueOnce({
        normalizedData: { name: null },
        validationErrors: [{ field: "name", error: "required" }],
        isValid: false,
      });

    const bullJob = createMockBullJob();
    const result = await revalidationProcessor(bullJob);

    expect(result.total).toBe(2);
    expect(result.valid).toBe(1);
    expect(result.invalid).toBe(1);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toEqual({
      recordId: "r-2",
      errors: [{ field: "name", error: "required" }],
    });
  });

  it("updates each record with normalization result", async () => {
    mockFieldMappingsFindMany.mockResolvedValue([]);
    mockEntityRecordsFindByConnectorEntityId.mockResolvedValue([record("r-1")]);
    mockNormalizeWithMappings.mockReturnValue({
      normalizedData: { name: "Alice" },
      validationErrors: null,
      isValid: true,
    });

    const bullJob = createMockBullJob();
    await revalidationProcessor(bullJob);

    expect(mockEntityRecordsBulkUpdateValidity).toHaveBeenCalledWith(
      [{ id: "r-1", validationErrors: null, isValid: true }],
      "mock-tx"
    );
  });

  // #757: the wide-table write throws on a refused geometry by default; a
  // geometry the sync already refused must not fail every later revalidation.
  it("skips a refused geometry instead of failing the job, and logs the count", async () => {
    mockFieldMappingsFindMany.mockResolvedValue([]);
    mockEntityRecordsFindByConnectorEntityId.mockResolvedValue([
      record("r-1", { geom: "" }),
      record("r-2", { geom: "" }),
    ]);
    mockNormalizeWithMappings.mockReturnValue({
      normalizedData: { geom: "" },
      validationErrors: null,
      isValid: true,
    });
    mockWideTableUpdateMany.mockResolvedValueOnce([
      { sourceId: "r-1", code: "GEOMETRY_INVALID_ON_IMPORT", fields: ["geom"] },
      { sourceId: "r-2", code: "GEOMETRY_INVALID_ON_IMPORT", fields: ["geom"] },
    ]);

    const result = await revalidationProcessor(createMockBullJob());

    expect(mockWideTableUpdateMany).toHaveBeenCalledWith(
      "ce-1",
      [
        { entityRecordId: "r-1", normalizedData: { geom: "" }, isValid: true },
        { entityRecordId: "r-2", normalizedData: { geom: "" }, isValid: true },
      ],
      "mock-tx",
      { onRejectedGeometry: "skip" }
    );
    expect(result).toEqual(expect.objectContaining({ total: 2, valid: 2 }));
    expect(mockLogger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ geometryRejected: 2 }),
      expect.any(String)
    );
    // #765: the skips are on the result, not only in the log.
    expect(RevalidationResultSchema.parse(result)).toMatchObject({
      geometryRejected: 2,
      geometryRejections: [
        { recordId: "r-1", fields: ["geom"] },
        { recordId: "r-2", fields: ["geom"] },
      ],
    });
  });

  it("#765: names at most 50 refused records, counting them all", async () => {
    mockFieldMappingsFindMany.mockResolvedValue([]);
    mockEntityRecordsFindByConnectorEntityId.mockResolvedValue(
      Array.from({ length: 120 }, (_, i) => record(`r-${i}`, { geom: "" }))
    );
    mockNormalizeWithMappings.mockReturnValue({
      normalizedData: { geom: "" },
      validationErrors: null,
      isValid: true,
    });
    // Batches of 100 and 20, every record refused.
    mockWideTableUpdateMany.mockImplementation(async (...args: unknown[]) =>
      (args[1] as Array<{ entityRecordId: string }>).map((r) => ({
        sourceId: r.entityRecordId,
        code: "GEOMETRY_INVALID_ON_IMPORT",
        fields: ["geom"],
      }))
    );

    const result = RevalidationResultSchema.parse(
      await revalidationProcessor(createMockBullJob())
    );

    expect(result.geometryRejected).toBe(120);
    expect(result.geometryRejections).toHaveLength(50);
    expect(result.geometryRejections?.[0]).toEqual({
      recordId: "r-0",
      fields: ["geom"],
    });
    mockWideTableUpdateMany.mockReset().mockResolvedValue([]);
  });

  it("#765: a clean run carries no geometry keys", async () => {
    mockFieldMappingsFindMany.mockResolvedValue([]);
    mockEntityRecordsFindByConnectorEntityId.mockResolvedValue([record("r-1")]);
    mockNormalizeWithMappings.mockReturnValue({
      normalizedData: { name: "Alice" },
      validationErrors: null,
      isValid: true,
    });

    const result = await revalidationProcessor(createMockBullJob());

    expect(result).not.toHaveProperty("geometryRejected");
    expect(result).not.toHaveProperty("geometryRejections");
  });

  // #761: one batched wide-table write per batch, not one per record.
  it("writes the wide table once per batch of 100", async () => {
    mockFieldMappingsFindMany.mockResolvedValue([]);
    mockEntityRecordsFindByConnectorEntityId.mockResolvedValue(
      Array.from({ length: 250 }, (_, i) => record(`r-${i}`))
    );
    mockNormalizeWithMappings.mockReturnValue({
      normalizedData: { name: "Alice" },
      validationErrors: null,
      isValid: true,
    });

    await revalidationProcessor(createMockBullJob());

    expect(mockWideTableUpdateMany).toHaveBeenCalledTimes(3);
    expect(
      mockWideTableUpdateMany.mock.calls.map((c) => (c[1] as unknown[]).length)
    ).toEqual([100, 100, 50]);
    expect(mockDbTransaction).toHaveBeenCalledTimes(3);
    // #764: the entity_records half is batched the same way.
    expect(
      mockEntityRecordsBulkUpdateValidity.mock.calls.map(
        (c) => (c[0] as unknown[]).length
      )
    ).toEqual([100, 100, 50]);
    expect(mockLogger.warn).not.toHaveBeenCalled();
  });

  it("reports progress at expected intervals", async () => {
    mockFieldMappingsFindMany.mockResolvedValue([]);
    mockEntityRecordsFindByConnectorEntityId.mockResolvedValue([
      record("r-1"),
      record("r-2"),
    ]);
    mockNormalizeWithMappings.mockReturnValue({
      normalizedData: {},
      validationErrors: null,
      isValid: true,
    });

    const bullJob = createMockBullJob();
    await revalidationProcessor(bullJob);

    const progressCalls = (bullJob.updateProgress as jest.Mock).mock.calls.map(
      (c) => c[0]
    );
    // Should include: 10 (after mappings), 20 (before batch loop), and 90 (end of single batch for 2 records)
    expect(progressCalls).toContain(10);
    expect(progressCalls).toContain(20);
    // Last batch progress should be 20 + (2/2)*70 = 90
    expect(progressCalls[progressCalls.length - 1]).toBe(90);
  });

  it("uses raw data field for re-normalization", async () => {
    mockFieldMappingsFindMany.mockResolvedValue([]);
    const rec = {
      id: "r-1",
      data: { raw_name: "Bob" },
      normalizedData: { name: "Bob" },
    };
    mockEntityRecordsFindByConnectorEntityId.mockResolvedValue([rec]);
    mockNormalizeWithMappings.mockReturnValue({
      normalizedData: { name: "Bob" },
      validationErrors: null,
      isValid: true,
    });

    const bullJob = createMockBullJob();
    await revalidationProcessor(bullJob);

    // Should pass `data` (raw) not `normalizedData` to normalizeWithMappings
    expect(mockNormalizeWithMappings).toHaveBeenCalledWith(expect.anything(), {
      raw_name: "Bob",
    });
  });
});
