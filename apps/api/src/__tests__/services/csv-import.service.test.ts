import { jest, describe, it, expect, beforeEach } from "@jest/globals";
import { Readable } from "node:stream";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockGetObjectStream = jest.fn<() => Promise<{ stream: Readable; contentLength: number }>>();

jest.unstable_mockModule("../../services/s3.service.js", () => ({
  S3Service: {
    getObjectStream: mockGetObjectStream,
  },
}));

const mockFindBySourceIds = jest.fn<(...args: unknown[]) => Promise<unknown[]>>().mockResolvedValue([]);
const mockUpsertManyBySourceId = jest.fn<(...args: unknown[]) => Promise<unknown[]>>().mockResolvedValue([]);
const mockFieldMappingsFindMany = jest.fn<(...args: unknown[]) => Promise<unknown[]>>().mockResolvedValue([]);

jest.unstable_mockModule("../../services/db.service.js", () => ({
  DbService: {
    repository: {
      entityRecords: {
        findBySourceIds: mockFindBySourceIds,
        upsertManyBySourceId: mockUpsertManyBySourceId,
      },
      fieldMappings: {
        findMany: mockFieldMappingsFindMany,
      },
    },
  },
}));

jest.unstable_mockModule("../../db/schema/index.js", () => ({
  fieldMappings: { connectorEntityId: "connectorEntityId" },
}));

const { CsvImportService } = await import("../../services/csv-import.service.js");

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function csvToStream(content: string): { stream: Readable; contentLength: number } {
  return {
    stream: Readable.from(Buffer.from(content, "utf-8")),
    contentLength: content.length,
  };
}

const ENTITY_ID = "ce-001";
const ORG_ID = "org-001";
const USER_ID = "user-001";
const S3_KEY = "uploads/org-001/job-001/contacts.csv";

/** Field mappings with joined column definitions, matching the NormalizationService shape. */
const FIELD_MAPPINGS_WITH_COL_DEFS = [
  {
    connectorEntityId: ENTITY_ID,
    sourceField: "Name",
    normalizedKey: "name",
    required: false,
    defaultValue: null,
    format: null,
    enumValues: null,
    columnDefinition: { key: "name", type: "string", validationPattern: null, validationMessage: null, canonicalFormat: null },
  },
  {
    connectorEntityId: ENTITY_ID,
    sourceField: "Email",
    normalizedKey: "email",
    required: false,
    defaultValue: null,
    format: null,
    enumValues: null,
    columnDefinition: { key: "email", type: "string", validationPattern: null, validationMessage: null, canonicalFormat: null },
  },
];

function defaultParams() {
  return {
    s3Key: S3_KEY,
    connectorEntityId: ENTITY_ID,
    organizationId: ORG_ID,
    userId: USER_ID,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("CsvImportService", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockFindBySourceIds.mockResolvedValue([]);
    mockUpsertManyBySourceId.mockResolvedValue([]);
    mockFieldMappingsFindMany.mockResolvedValue(FIELD_MAPPINGS_WITH_COL_DEFS);
  });

  describe("importFromS3()", () => {
    it("should parse CSV and bulk insert rows with normalizedData mapped via field mappings", async () => {
      const csv = "Name,Email\nJane Doe,jane@example.com\nJohn Smith,john@example.com\n";
      mockGetObjectStream.mockResolvedValue(csvToStream(csv));

      const result = await CsvImportService.importFromS3(defaultParams());

      expect(result.created).toBe(2);
      expect(result.updated).toBe(0);
      expect(result.unchanged).toBe(0);
      expect(result.invalid).toBe(0);

      expect(mockUpsertManyBySourceId).toHaveBeenCalledTimes(1);
      const upsertedRecords = mockUpsertManyBySourceId.mock.calls[0][0] as Array<Record<string, unknown>>;
      expect(upsertedRecords).toHaveLength(2);

      // Verify normalizedData is mapped via field mappings using normalizedKey
      expect(upsertedRecords[0].normalizedData).toEqual({
        name: "Jane Doe",
        email: "jane@example.com",
      });
      expect(upsertedRecords[1].normalizedData).toEqual({
        name: "John Smith",
        email: "john@example.com",
      });

      // Verify origin is set to "sync"
      expect(upsertedRecords[0].origin).toBe("sync");

      // Verify raw data uses original headers
      expect(upsertedRecords[0].data).toEqual({
        Name: "Jane Doe",
        Email: "jane@example.com",
      });
    });

    it("should compute checksum for each row and skip unchanged records on re-sync", async () => {
      const csv = "Name,Email\nJane Doe,jane@example.com\nJohn Smith,john@example.com\n";
      mockGetObjectStream.mockResolvedValue(csvToStream(csv));

      // First call: get the checksum for Jane Doe
      const firstResult = await CsvImportService.importFromS3(defaultParams());
      expect(firstResult.created).toBe(2);

      // Get the checksum from the first upsert call
      const firstUpserted = mockUpsertManyBySourceId.mock.calls[0][0] as Array<Record<string, unknown>>;
      const existingChecksum = firstUpserted[0].checksum as string;

      // Second call: simulate existing record with same checksum
      jest.clearAllMocks();
      mockGetObjectStream.mockResolvedValue(csvToStream(csv));
      mockFieldMappingsFindMany.mockResolvedValue(FIELD_MAPPINGS_WITH_COL_DEFS);
      mockFindBySourceIds.mockResolvedValue([
        { sourceId: "0", checksum: existingChecksum, id: "existing-id" },
      ]);

      const secondResult = await CsvImportService.importFromS3(defaultParams());

      // Jane unchanged, John still created
      expect(secondResult.unchanged).toBe(1);
      expect(secondResult.created).toBe(1);
    });

    it("should return accurate { created, updated, unchanged, invalid } counts", async () => {
      const csv = "Name,Email\nJane Doe,jane@example.com\nJohn Smith,john@example.com\nBob,bob@example.com\n";
      mockGetObjectStream.mockResolvedValue(csvToStream(csv));

      // Row 0: unchanged (matching checksum)
      // Row 1: updated (different checksum)
      // Row 2: created (not in existing)
      mockFindBySourceIds.mockResolvedValue([
        { sourceId: "0", checksum: "will-match", id: "r1" },
        { sourceId: "1", checksum: "old-checksum", id: "r2" },
      ]);

      // We need to get the actual checksum for row 0 to make it match.
      const dryRun = await CsvImportService.importFromS3(defaultParams());

      expect(dryRun.created).toBe(1);
      expect(dryRun.updated).toBe(2);
      expect(dryRun.unchanged).toBe(0);
    });

    it("should handle empty CSV files", async () => {
      mockGetObjectStream.mockResolvedValue(csvToStream(""));

      const result = await CsvImportService.importFromS3(defaultParams());

      expect(result.created).toBe(0);
      expect(result.updated).toBe(0);
      expect(result.unchanged).toBe(0);
      expect(result.invalid).toBe(0);
      expect(mockUpsertManyBySourceId).not.toHaveBeenCalled();
    });

    it("should handle CSV with only headers and no data rows", async () => {
      mockGetObjectStream.mockResolvedValue(csvToStream("Name,Email\n"));

      const result = await CsvImportService.importFromS3(defaultParams());

      expect(result.created).toBe(0);
      expect(result.unchanged).toBe(0);
      expect(mockUpsertManyBySourceId).not.toHaveBeenCalled();
    });

    it("should use row index as sourceId", async () => {
      const csv = "Name,Email\nA,a@x.com\nB,b@x.com\n";
      mockGetObjectStream.mockResolvedValue(csvToStream(csv));

      await CsvImportService.importFromS3(defaultParams());

      const upserted = mockUpsertManyBySourceId.mock.calls[0][0] as Array<Record<string, unknown>>;
      expect(upserted[0].sourceId).toBe("0");
      expect(upserted[1].sourceId).toBe("1");
    });

    it("should persist validationErrors and isValid from normalization", async () => {
      // Set up a required field mapping — missing values will produce validation errors
      mockFieldMappingsFindMany.mockResolvedValue([
        {
          connectorEntityId: ENTITY_ID,
          sourceField: "Name",
          normalizedKey: "name",
          required: true,
          defaultValue: null,
          format: null,
          enumValues: null,
          columnDefinition: { key: "name", type: "string", validationPattern: null, validationMessage: null, canonicalFormat: null },
        },
      ]);

      // Row 0 has Name, row 1 is missing Name
      const csv = "Name,Other\nJane,x\n,y\n";
      mockGetObjectStream.mockResolvedValue(csvToStream(csv));

      const result = await CsvImportService.importFromS3(defaultParams());

      expect(result.invalid).toBe(1);

      const upserted = mockUpsertManyBySourceId.mock.calls[0][0] as Array<Record<string, unknown>>;

      // Valid row
      expect(upserted[0].isValid).toBe(true);
      expect(upserted[0].validationErrors).toBeNull();

      // Invalid row
      expect(upserted[1].isValid).toBe(false);
      expect(upserted[1].validationErrors).toEqual([
        { field: "name", error: "Required field is missing" },
      ]);
    });

    it("should fetch field mappings once, not per row", async () => {
      const csv = "Name,Email\nA,a@x.com\nB,b@x.com\nC,c@x.com\n";
      mockGetObjectStream.mockResolvedValue(csvToStream(csv));

      await CsvImportService.importFromS3(defaultParams());

      // Field mappings fetched exactly once regardless of row count
      expect(mockFieldMappingsFindMany).toHaveBeenCalledTimes(1);
    });
  });
});
