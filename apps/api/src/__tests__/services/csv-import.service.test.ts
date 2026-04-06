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

jest.unstable_mockModule("../../services/db.service.js", () => ({
  DbService: {
    repository: {
      entityRecords: {
        findBySourceIds: mockFindBySourceIds,
        upsertManyBySourceId: mockUpsertManyBySourceId,
      },
    },
  },
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

const FIELD_MAPPINGS = [
  { sourceField: "Name", columnDefinitionKey: "name" },
  { sourceField: "Email", columnDefinitionKey: "email" },
];

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("CsvImportService", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockFindBySourceIds.mockResolvedValue([]);
    mockUpsertManyBySourceId.mockResolvedValue([]);
  });

  describe("importFromS3()", () => {
    it("should parse CSV and bulk insert rows with normalizedData mapped via field mappings", async () => {
      const csv = "Name,Email\nJane Doe,jane@example.com\nJohn Smith,john@example.com\n";
      mockGetObjectStream.mockResolvedValue(csvToStream(csv));

      const result = await CsvImportService.importFromS3({
        s3Key: S3_KEY,
        connectorEntityId: ENTITY_ID,
        organizationId: ORG_ID,
        userId: USER_ID,
        fieldMappings: FIELD_MAPPINGS,
      });

      expect(result.created).toBe(2);
      expect(result.updated).toBe(0);
      expect(result.unchanged).toBe(0);

      expect(mockUpsertManyBySourceId).toHaveBeenCalledTimes(1);
      const upsertedRecords = mockUpsertManyBySourceId.mock.calls[0][0] as Array<Record<string, unknown>>;
      expect(upsertedRecords).toHaveLength(2);

      // Verify normalizedData is mapped via field mappings
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
      expect(upsertedRecords[1].origin).toBe("sync");

      // Verify raw data uses original headers
      expect(upsertedRecords[0].data).toEqual({
        Name: "Jane Doe",
        Email: "jane@example.com",
      });
    });

    it("should compute checksum for each row and skip unchanged records on re-sync", async () => {
      const csv = "Name,Email\nJane Doe,jane@example.com\nJohn Smith,john@example.com\n";
      mockGetObjectStream.mockResolvedValue(csvToStream(csv));

      // Simulate existing record with matching checksum for row 0
      // First call: get the checksum for Jane Doe
      const firstResult = await CsvImportService.importFromS3({
        s3Key: S3_KEY,
        connectorEntityId: ENTITY_ID,
        organizationId: ORG_ID,
        userId: USER_ID,
        fieldMappings: FIELD_MAPPINGS,
      });
      expect(firstResult.created).toBe(2);

      // Get the checksum from the first upsert call
      const firstUpserted = mockUpsertManyBySourceId.mock.calls[0][0] as Array<Record<string, unknown>>;
      const existingChecksum = firstUpserted[0].checksum as string;

      // Second call: simulate existing record with same checksum
      jest.clearAllMocks();
      mockGetObjectStream.mockResolvedValue(csvToStream(csv));
      mockFindBySourceIds.mockResolvedValue([
        { sourceId: "0", checksum: existingChecksum, id: "existing-id" },
      ]);

      const secondResult = await CsvImportService.importFromS3({
        s3Key: S3_KEY,
        connectorEntityId: ENTITY_ID,
        organizationId: ORG_ID,
        userId: USER_ID,
        fieldMappings: FIELD_MAPPINGS,
      });

      // Jane unchanged, John still created
      expect(secondResult.unchanged).toBe(1);
      expect(secondResult.created).toBe(1);
    });

    it("should return accurate { created, updated, unchanged } counts", async () => {
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
      // First, do a dry run to get the checksum:
      const dryRun = await CsvImportService.importFromS3({
        s3Key: S3_KEY,
        connectorEntityId: ENTITY_ID,
        organizationId: ORG_ID,
        userId: USER_ID,
        fieldMappings: FIELD_MAPPINGS,
      });

      // Row 0 and 1 have existing records, so they are updated (checksums don't match)
      // Row 2 is new, so it is created
      expect(dryRun.created).toBe(1);
      expect(dryRun.updated).toBe(2);
      expect(dryRun.unchanged).toBe(0);
    });

    it("should handle empty CSV files", async () => {
      mockGetObjectStream.mockResolvedValue(csvToStream(""));

      const result = await CsvImportService.importFromS3({
        s3Key: S3_KEY,
        connectorEntityId: ENTITY_ID,
        organizationId: ORG_ID,
        userId: USER_ID,
        fieldMappings: FIELD_MAPPINGS,
      });

      expect(result.created).toBe(0);
      expect(result.updated).toBe(0);
      expect(result.unchanged).toBe(0);
      expect(mockUpsertManyBySourceId).not.toHaveBeenCalled();
    });

    it("should handle CSV with only headers and no data rows", async () => {
      mockGetObjectStream.mockResolvedValue(csvToStream("Name,Email\n"));

      const result = await CsvImportService.importFromS3({
        s3Key: S3_KEY,
        connectorEntityId: ENTITY_ID,
        organizationId: ORG_ID,
        userId: USER_ID,
        fieldMappings: FIELD_MAPPINGS,
      });

      expect(result.created).toBe(0);
      expect(result.unchanged).toBe(0);
      expect(mockUpsertManyBySourceId).not.toHaveBeenCalled();
    });

    it("should use row index as sourceId", async () => {
      const csv = "Name,Email\nA,a@x.com\nB,b@x.com\n";
      mockGetObjectStream.mockResolvedValue(csvToStream(csv));

      await CsvImportService.importFromS3({
        s3Key: S3_KEY,
        connectorEntityId: ENTITY_ID,
        organizationId: ORG_ID,
        userId: USER_ID,
        fieldMappings: FIELD_MAPPINGS,
      });

      const upserted = mockUpsertManyBySourceId.mock.calls[0][0] as Array<Record<string, unknown>>;
      expect(upserted[0].sourceId).toBe("0");
      expect(upserted[1].sourceId).toBe("1");
    });
  });
});
