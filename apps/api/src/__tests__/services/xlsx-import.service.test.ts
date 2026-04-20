import { jest, describe, it, expect, beforeEach } from "@jest/globals";
import { Readable } from "node:stream";

import {
  buildMultiSheetXlsx,
  buildSingleSheetXlsx,
} from "../utils/xlsx-fixtures.util.js";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockGetObjectStream =
  jest.fn<() => Promise<{ stream: Readable; contentLength: number }>>();

jest.unstable_mockModule("../../services/s3.service.js", () => ({
  S3Service: {
    getObjectStream: mockGetObjectStream,
  },
}));

const mockFindBySourceIds = jest
  .fn<(...args: unknown[]) => Promise<unknown[]>>()
  .mockResolvedValue([]);
const mockUpsertManyBySourceId = jest
  .fn<(...args: unknown[]) => Promise<unknown[]>>()
  .mockResolvedValue([]);
const mockFieldMappingsFindMany = jest
  .fn<(...args: unknown[]) => Promise<unknown[]>>()
  .mockResolvedValue([]);

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

const { XlsxImportService } =
  await import("../../services/xlsx-import.service.js");

// ---------------------------------------------------------------------------
// Helpers / fixtures
// ---------------------------------------------------------------------------

const ENTITY_ID = "ce-001";
const ORG_ID = "org-001";
const USER_ID = "user-001";
const S3_KEY = "uploads/org-001/job-001/contacts.xlsx";

const FIELD_MAPPINGS_WITH_COL_DEFS = [
  {
    connectorEntityId: ENTITY_ID,
    sourceField: "Name",
    normalizedKey: "name",
    required: false,
    defaultValue: null,
    format: null,
    enumValues: null,
    columnDefinition: {
      key: "name",
      type: "string",
      validationPattern: null,
      validationMessage: null,
      canonicalFormat: null,
    },
  },
  {
    connectorEntityId: ENTITY_ID,
    sourceField: "Email",
    normalizedKey: "email",
    required: false,
    defaultValue: null,
    format: null,
    enumValues: null,
    columnDefinition: {
      key: "email",
      type: "string",
      validationPattern: null,
      validationMessage: null,
      canonicalFormat: null,
    },
  },
];

function defaultParams(sheetName = "Contacts") {
  return {
    s3Key: S3_KEY,
    sheetName,
    connectorEntityId: ENTITY_ID,
    organizationId: ORG_ID,
    userId: USER_ID,
  };
}

function bufferToStream(buf: Buffer): {
  stream: Readable;
  contentLength: number;
} {
  return { stream: Readable.from(buf), contentLength: buf.length };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("XlsxImportService", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockFindBySourceIds.mockResolvedValue([]);
    mockUpsertManyBySourceId.mockResolvedValue([]);
    mockFieldMappingsFindMany.mockResolvedValue(FIELD_MAPPINGS_WITH_COL_DEFS);
  });

  describe("importFromS3()", () => {
    it("streams a sheet from S3 and bulk-inserts rows with normalizedData", async () => {
      const xlsx = await buildSingleSheetXlsx("Contacts", [
        ["Name", "Email"],
        ["Jane Doe", "jane@example.com"],
        ["John Smith", "john@example.com"],
      ]);
      mockGetObjectStream.mockResolvedValue(bufferToStream(xlsx));

      const result = await XlsxImportService.importFromS3(defaultParams());

      expect(result.created).toBe(2);
      expect(result.updated).toBe(0);
      expect(result.unchanged).toBe(0);
      expect(result.invalid).toBe(0);

      expect(mockUpsertManyBySourceId).toHaveBeenCalledTimes(1);
      const upserted = mockUpsertManyBySourceId.mock.calls[0][0] as Array<
        Record<string, unknown>
      >;
      expect(upserted).toHaveLength(2);
      expect(upserted[0].normalizedData).toEqual({
        name: "Jane Doe",
        email: "jane@example.com",
      });
      expect(upserted[0].data).toEqual({
        Name: "Jane Doe",
        Email: "jane@example.com",
      });
    });

    it("imports only the requested sheet from a multi-sheet workbook", async () => {
      const xlsx = await buildMultiSheetXlsx({
        Contacts: [
          ["Name", "Email"],
          ["Alice", "a@x.com"],
        ],
        Deals: [
          ["Name", "Email"],
          ["Bob", "b@x.com"],
          ["Carol", "c@x.com"],
        ],
      });
      mockGetObjectStream.mockResolvedValue(bufferToStream(xlsx));

      const result = await XlsxImportService.importFromS3(
        defaultParams("Deals")
      );

      expect(result.created).toBe(2);
      const upserted = mockUpsertManyBySourceId.mock.calls[0][0] as Array<
        Record<string, unknown>
      >;
      expect((upserted[0].data as Record<string, string>).Name).toBe("Bob");
      expect((upserted[1].data as Record<string, string>).Name).toBe("Carol");
    });

    it("throws ProcessorError(UPLOAD_SHEET_NOT_FOUND) for a missing sheet", async () => {
      const xlsx = await buildSingleSheetXlsx("Contacts", [
        ["Name"],
        ["Alice"],
      ]);
      mockGetObjectStream.mockResolvedValue(bufferToStream(xlsx));

      await expect(
        XlsxImportService.importFromS3(defaultParams("Nope"))
      ).rejects.toMatchObject({
        name: "ProcessorError",
        code: "UPLOAD_SHEET_NOT_FOUND",
      });
    });

    it("returns all-zero counts when the sheet has no data rows", async () => {
      const xlsx = await buildSingleSheetXlsx("Contacts", [["Name", "Email"]]);
      mockGetObjectStream.mockResolvedValue(bufferToStream(xlsx));

      const result = await XlsxImportService.importFromS3(defaultParams());

      expect(result).toEqual({
        created: 0,
        updated: 0,
        unchanged: 0,
        invalid: 0,
      });
      expect(mockUpsertManyBySourceId).not.toHaveBeenCalled();
    });

    it("uses row index as sourceId", async () => {
      const xlsx = await buildSingleSheetXlsx("Contacts", [
        ["Name", "Email"],
        ["A", "a@x.com"],
        ["B", "b@x.com"],
      ]);
      mockGetObjectStream.mockResolvedValue(bufferToStream(xlsx));

      await XlsxImportService.importFromS3(defaultParams());

      const upserted = mockUpsertManyBySourceId.mock.calls[0][0] as Array<
        Record<string, unknown>
      >;
      expect(upserted[0].sourceId).toBe("0");
      expect(upserted[1].sourceId).toBe("1");
    });

    it("fetches field mappings exactly once regardless of row count", async () => {
      const rows: (string | number)[][] = [["Name", "Email"]];
      for (let i = 0; i < 50; i++) rows.push([`User${i}`, `u${i}@x.com`]);
      const xlsx = await buildSingleSheetXlsx("Contacts", rows);
      mockGetObjectStream.mockResolvedValue(bufferToStream(xlsx));

      await XlsxImportService.importFromS3(defaultParams());

      expect(mockFieldMappingsFindMany).toHaveBeenCalledTimes(1);
    });
  });
});
