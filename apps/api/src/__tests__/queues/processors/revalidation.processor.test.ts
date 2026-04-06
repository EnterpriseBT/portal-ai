import { jest, describe, it, expect, beforeEach } from "@jest/globals";
import type { Job as BullJob } from "bullmq";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockFieldMappingsFindMany = jest.fn<(...args: unknown[]) => Promise<unknown[]>>();
const mockEntityRecordsFindByConnectorEntityId = jest.fn<(...args: unknown[]) => Promise<unknown[]>>();
const mockEntityRecordsUpdate = jest.fn<(...args: unknown[]) => Promise<unknown>>();
const mockNormalizeWithMappings = jest.fn<(...args: unknown[]) => unknown>();

jest.unstable_mockModule("../../../services/db.service.js", () => ({
  DbService: {
    repository: {
      fieldMappings: { findMany: mockFieldMappingsFindMany },
      entityRecords: {
        findByConnectorEntityId: mockEntityRecordsFindByConnectorEntityId,
        update: mockEntityRecordsUpdate,
      },
    },
  },
}));

jest.unstable_mockModule("../../../services/normalization.service.js", () => ({
  NormalizationService: {
    normalizeWithMappings: mockNormalizeWithMappings,
  },
}));

jest.unstable_mockModule("../../../db/schema/index.js", () => ({
  fieldMappings: { connectorEntityId: "connectorEntityId" },
}));

const { revalidationProcessor } = await import(
  "../../../queues/processors/revalidation.processor.js"
);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createMockBullJob(
  data: Record<string, unknown> = {},
): BullJob {
  return {
    data: { jobId: "job-001", type: "revalidation", connectorEntityId: "ce-1", organizationId: "org-1", ...data },
    updateProgress: jest.fn<(progress: number) => Promise<void>>().mockResolvedValue(undefined),
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
  mockEntityRecordsUpdate.mockResolvedValue({});
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
    const mappings = [{ id: "fm-1", sourceField: "name", normalizedKey: "name", columnDefinition: { key: "name", type: "string" } }];
    mockFieldMappingsFindMany.mockResolvedValue(mappings);
    mockEntityRecordsFindByConnectorEntityId.mockResolvedValue([
      record("r-1", { name: "Alice" }),
      record("r-2", { name: "" }),
    ]);

    mockNormalizeWithMappings
      .mockReturnValueOnce({ normalizedData: { name: "Alice" }, validationErrors: null, isValid: true })
      .mockReturnValueOnce({ normalizedData: { name: null }, validationErrors: [{ field: "name", error: "required" }], isValid: false });

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

    expect(mockEntityRecordsUpdate).toHaveBeenCalledWith("r-1", {
      normalizedData: { name: "Alice" },
      validationErrors: null,
      isValid: true,
    });
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
      (c) => c[0],
    );
    // Should include: 10 (after mappings), 20 (before batch loop), and 90 (end of single batch for 2 records)
    expect(progressCalls).toContain(10);
    expect(progressCalls).toContain(20);
    // Last batch progress should be 20 + (2/2)*70 = 90
    expect(progressCalls[progressCalls.length - 1]).toBe(90);
  });

  it("uses raw data field for re-normalization", async () => {
    mockFieldMappingsFindMany.mockResolvedValue([]);
    const rec = { id: "r-1", data: { raw_name: "Bob" }, normalizedData: { name: "Bob" } };
    mockEntityRecordsFindByConnectorEntityId.mockResolvedValue([rec]);
    mockNormalizeWithMappings.mockReturnValue({
      normalizedData: { name: "Bob" },
      validationErrors: null,
      isValid: true,
    });

    const bullJob = createMockBullJob();
    await revalidationProcessor(bullJob);

    // Should pass `data` (raw) not `normalizedData` to normalizeWithMappings
    expect(mockNormalizeWithMappings).toHaveBeenCalledWith(
      expect.anything(),
      { raw_name: "Bob" },
    );
  });
});
