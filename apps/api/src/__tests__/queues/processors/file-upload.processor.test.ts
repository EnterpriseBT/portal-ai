import { Readable } from "node:stream";

import { jest, describe, it, expect, beforeEach } from "@jest/globals";
import type { Job as BullJob } from "bullmq";

import { FileUploadResultSchema } from "@portalai/core/models";
import type { FileUploadFile } from "@portalai/core/models";

import {
  buildMultiSheetXlsx,
  buildSingleSheetXlsx,
} from "../../utils/xlsx-fixtures.util.js";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockHeadObject = jest.fn<
  (key: string) => Promise<{ contentLength: number; contentType: string } | null>
>();
const mockGetObjectStream = jest.fn<
  (key: string) => Promise<{ stream: Readable; contentLength: number }>
>();

const mockFindByOrganizationId = jest.fn<() => Promise<unknown[]>>().mockResolvedValue([]);

const mockGetRecommendations = jest.fn<(input: unknown) => Promise<unknown>>();

jest.unstable_mockModule("../../../services/s3.service.js", () => ({
  S3Service: {
    headObject: mockHeadObject,
    getObjectStream: mockGetObjectStream,
  },
}));

jest.unstable_mockModule("../../../services/db.service.js", () => ({
  DbService: {
    repository: {
      columnDefinitions: {
        findByOrganizationId: mockFindByOrganizationId,
      },
    },
  },
}));

jest.unstable_mockModule("../../../services/file-analysis.service.js", () => ({
  FileAnalysisService: {
    getRecommendations: mockGetRecommendations,
  },
}));

const { fileUploadProcessor } = await import(
  "../../../queues/processors/file-upload.processor.js"
);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createMockBullJob(files: FileUploadFile[]): BullJob {
  return {
    data: {
      jobId: "job-001",
      type: "file_upload",
      files,
      organizationId: "org-001",
      connectorDefinitionId: "conn-def-001",
    },
    updateProgress: jest
      .fn<(progress: number) => Promise<void>>()
      .mockResolvedValue(undefined),
  } as unknown as BullJob;
}

function makeFile(name: string, sizeBytes = 100): FileUploadFile {
  return {
    originalName: name,
    s3Key: `uploads/org-001/job-001/${name}`,
    sizeBytes,
  };
}

function setupS3ForContent(file: FileUploadFile, content: string): void {
  const buf = Buffer.from(content, "utf-8");
  mockHeadObject.mockImplementation(async (key: string) => {
    if (key === file.s3Key) {
      return { contentLength: buf.length, contentType: "text/csv" };
    }
    return null;
  });
  mockGetObjectStream.mockImplementation(async (key: string) => {
    if (key === file.s3Key) {
      return { stream: Readable.from(buf), contentLength: buf.length };
    }
    throw new Error("Not found");
  });
}

function setupS3ForMultipleFiles(
  entries: Array<{ file: FileUploadFile; content: string }>
): void {
  const map = new Map<string, Buffer>();
  for (const { file, content } of entries) {
    map.set(file.s3Key, Buffer.from(content, "utf-8"));
  }
  mockHeadObject.mockImplementation(async (key: string) => {
    const buf = map.get(key);
    if (buf) return { contentLength: buf.length, contentType: "text/csv" };
    return null;
  });
  mockGetObjectStream.mockImplementation(async (key: string) => {
    const buf = map.get(key);
    if (buf) return { stream: Readable.from(buf), contentLength: buf.length };
    throw new Error("Not found");
  });
}

/** Buffer-based variant for binary fixtures (e.g. XLSX). */
function setupS3ForBinaryFiles(
  entries: Array<{ file: FileUploadFile; buffer: Buffer; contentType?: string }>
): void {
  const map = new Map<string, { buf: Buffer; contentType: string }>();
  for (const { file, buffer, contentType } of entries) {
    map.set(file.s3Key, { buf: buffer, contentType: contentType ?? "application/octet-stream" });
  }
  mockHeadObject.mockImplementation(async (key: string) => {
    const entry = map.get(key);
    if (entry) return { contentLength: entry.buf.length, contentType: entry.contentType };
    return null;
  });
  mockGetObjectStream.mockImplementation(async (key: string) => {
    const entry = map.get(key);
    if (entry) return { stream: Readable.from(entry.buf), contentLength: entry.buf.length };
    throw new Error("Not found");
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("fileUploadProcessor", () => {
  beforeEach(() => {
    mockHeadObject.mockReset();
    mockGetObjectStream.mockReset();
    mockFindByOrganizationId.mockReset().mockResolvedValue([]);
    mockGetRecommendations.mockReset().mockImplementation(async (raw: unknown) => {
      const input = raw as { parseResult: { fileName: string; columnStats: Array<{ name: string; sampleValues: string[] }> } };
      return {
        entityKey: input.parseResult.fileName.replace(/\.[^.]+$/, "").toLowerCase(),
        entityLabel: input.parseResult.fileName.replace(/\.[^.]+$/, ""),
        sourceFileName: input.parseResult.fileName,
        columns: input.parseResult.columnStats.map((s: { name: string; sampleValues: string[] }) => ({
          sourceField: s.name,
          existingColumnDefinitionId: "cd-text",
          existingColumnDefinitionKey: "text",
          confidence: 0.5,
          sampleValues: s.sampleValues,
          format: null,
          isPrimaryKey: false,
          required: false,
          normalizedKey: s.name.toLowerCase(),
          defaultValue: null,
          enumValues: null,
        })),
      };
    });
  });

  // ── S3 verification phase ───────────────────────────────────────────────

  describe("S3 verification phase", () => {
    it("calls headObject() per file", async () => {
      const files = [makeFile("a.csv", 10), makeFile("b.csv", 20)];
      const csvContent = "name,email\nAlice,alice@test.com\n";
      setupS3ForMultipleFiles([
        { file: { ...files[0], sizeBytes: Buffer.byteLength(csvContent) }, content: csvContent },
        { file: { ...files[1], sizeBytes: Buffer.byteLength(csvContent) }, content: csvContent },
      ]);
      // Override file sizes to match actual content
      files[0].sizeBytes = Buffer.byteLength(csvContent);
      files[1].sizeBytes = Buffer.byteLength(csvContent);

      const bullJob = createMockBullJob(files);
      await fileUploadProcessor(bullJob);

      expect(mockHeadObject).toHaveBeenCalledWith(files[0].s3Key);
      expect(mockHeadObject).toHaveBeenCalledWith(files[1].s3Key);
    });

    it("throws UPLOAD_FILE_MISSING when file not found in S3", async () => {
      const files = [makeFile("missing.csv")];
      mockHeadObject.mockResolvedValue(null);

      const bullJob = createMockBullJob(files);
      await expect(fileUploadProcessor(bullJob)).rejects.toThrow(
        /not found in S3/
      );
    });

    it("throws UPLOAD_EMPTY_FILE when file has 0 bytes", async () => {
      const files = [makeFile("empty.csv")];
      mockHeadObject.mockResolvedValue({ contentLength: 0, contentType: "text/csv" });

      const bullJob = createMockBullJob(files);
      await expect(fileUploadProcessor(bullJob)).rejects.toThrow(/empty/);
    });

    it("throws UPLOAD_FILE_SIZE_MISMATCH when S3 size differs from expected", async () => {
      const files = [makeFile("mismatch.csv", 500)];
      mockHeadObject.mockResolvedValue({ contentLength: 999, contentType: "text/csv" });

      const bullJob = createMockBullJob(files);
      await expect(fileUploadProcessor(bullJob)).rejects.toThrow(
        /size mismatch/
      );
    });

    it("throws UPLOAD_S3_READ_ERROR when headObject throws", async () => {
      const files = [makeFile("error.csv")];
      mockHeadObject.mockRejectedValue(new Error("network failure"));

      const bullJob = createMockBullJob(files);
      await expect(fileUploadProcessor(bullJob)).rejects.toThrow(
        /Failed to read file/
      );
    });
  });

  // ── CSV parsing — delimiter detection ───────────────────────────────────

  describe("CSV parsing — delimiter detection", () => {
    it("detects comma delimiter", async () => {
      const file = makeFile("comma.csv");
      const content = "name,email,phone\nAlice,alice@test.com,555-0001\n";
      file.sizeBytes = Buffer.byteLength(content);
      setupS3ForContent(file, content);

      const bullJob = createMockBullJob([file]);
      const result = await fileUploadProcessor(bullJob);
      expect(result.parseResults![0].delimiter).toBe(",");
    });

    it("detects tab delimiter", async () => {
      const file = makeFile("tabs.csv");
      const content = "name\temail\tphone\nAlice\talice@test.com\t555-0001\n";
      file.sizeBytes = Buffer.byteLength(content);
      setupS3ForContent(file, content);

      const bullJob = createMockBullJob([file]);
      const result = await fileUploadProcessor(bullJob);
      expect(result.parseResults![0].delimiter).toBe("\t");
    });

    it("detects semicolon delimiter", async () => {
      const file = makeFile("semi.csv");
      const content = "name;email;phone\nAlice;alice@test.com;555-0001\n";
      file.sizeBytes = Buffer.byteLength(content);
      setupS3ForContent(file, content);

      const bullJob = createMockBullJob([file]);
      const result = await fileUploadProcessor(bullJob);
      expect(result.parseResults![0].delimiter).toBe(";");
    });

    it("detects pipe delimiter", async () => {
      const file = makeFile("pipe.csv");
      const content = "name|email|phone\nAlice|alice@test.com|555-0001\n";
      file.sizeBytes = Buffer.byteLength(content);
      setupS3ForContent(file, content);

      const bullJob = createMockBullJob([file]);
      const result = await fileUploadProcessor(bullJob);
      expect(result.parseResults![0].delimiter).toBe("|");
    });
  });

  // ── CSV parsing — encoding detection ────────────────────────────────────

  describe("CSV parsing — encoding detection", () => {
    it("detects UTF-8 encoding", async () => {
      const file = makeFile("utf8.csv");
      const content = "name,email\nAlice,alice@test.com\n";
      file.sizeBytes = Buffer.byteLength(content);
      setupS3ForContent(file, content);

      const bullJob = createMockBullJob([file]);
      const result = await fileUploadProcessor(bullJob);
      // chardet typically returns "UTF-8" or "ascii" for plain ASCII content
      expect(result.parseResults![0].encoding).toBeTruthy();
    });
  });

  // ── CSV parsing — header detection ──────────────────────────────────────

  describe("CSV parsing — header detection", () => {
    it("detects header row when first row contains non-numeric strings", async () => {
      const file = makeFile("with-header.csv");
      const content = "name,email,phone\nAlice,alice@test.com,555-0001\n";
      file.sizeBytes = Buffer.byteLength(content);
      setupS3ForContent(file, content);

      const bullJob = createMockBullJob([file]);
      const result = await fileUploadProcessor(bullJob);
      expect(result.parseResults![0].hasHeader).toBe(true);
      expect(result.parseResults![0].headers).toEqual(["name", "email", "phone"]);
    });

    it("does not detect header when first row has numeric values", async () => {
      const file = makeFile("no-header.csv");
      const content = "1,2,3\n4,5,6\n";
      file.sizeBytes = Buffer.byteLength(content);
      setupS3ForContent(file, content);

      const bullJob = createMockBullJob([file]);
      const result = await fileUploadProcessor(bullJob);
      expect(result.parseResults![0].hasHeader).toBe(false);
      expect(result.parseResults![0].headers).toEqual([
        "column_1",
        "column_2",
        "column_3",
      ]);
    });
  });

  // ── CSV parsing — row count and sample rows ─────────────────────────────

  describe("CSV parsing — row count and sample rows", () => {
    it("counts data rows correctly (excluding header)", async () => {
      const file = makeFile("count.csv");
      const rows = ["name,value"];
      for (let i = 0; i < 100; i++) rows.push(`item${i},${i}`);
      const content = rows.join("\n") + "\n";
      file.sizeBytes = Buffer.byteLength(content);
      setupS3ForContent(file, content);

      const bullJob = createMockBullJob([file]);
      const result = await fileUploadProcessor(bullJob);
      expect(result.parseResults![0].rowCount).toBe(100);
    });

    it("caps sample rows at 50", async () => {
      const file = makeFile("many-rows.csv");
      const rows = ["name,value"];
      for (let i = 0; i < 200; i++) rows.push(`item${i},${i}`);
      const content = rows.join("\n") + "\n";
      file.sizeBytes = Buffer.byteLength(content);
      setupS3ForContent(file, content);

      const bullJob = createMockBullJob([file]);
      const result = await fileUploadProcessor(bullJob);
      expect(result.parseResults![0].sampleRows.length).toBe(50);
      expect(result.parseResults![0].rowCount).toBe(200);
    });
  });

  // ── Column stats ────────────────────────────────────────────────────────

  describe("Column stats", () => {
    it("accumulates null rate correctly", async () => {
      const file = makeFile("nulls.csv");
      const content = "name,value\nAlice,10\nBob,\nCarol,30\nDave,\n";
      file.sizeBytes = Buffer.byteLength(content);
      setupS3ForContent(file, content);

      const bullJob = createMockBullJob([file]);
      const result = await fileUploadProcessor(bullJob);
      const valueStats = result.parseResults![0].columnStats.find(
        (s) => s.name === "value"
      )!;
      expect(valueStats.nullCount).toBe(2);
      expect(valueStats.totalCount).toBe(4);
      expect(valueStats.nullRate).toBe(0.5);
    });

    it("tracks min/max length", async () => {
      const file = makeFile("lengths.csv");
      const content = "name\nAb\nAbcde\nAbc\n";
      file.sizeBytes = Buffer.byteLength(content);
      setupS3ForContent(file, content);

      const bullJob = createMockBullJob([file]);
      const result = await fileUploadProcessor(bullJob);
      const stats = result.parseResults![0].columnStats[0];
      expect(stats.minLength).toBe(2);
      expect(stats.maxLength).toBe(5);
    });

    it("caps unique count at 1,000 and marks as capped", async () => {
      const file = makeFile("unique.csv");
      const rows = ["id"];
      for (let i = 0; i < 1500; i++) rows.push(`unique_${i}`);
      const content = rows.join("\n") + "\n";
      file.sizeBytes = Buffer.byteLength(content);
      setupS3ForContent(file, content);

      const bullJob = createMockBullJob([file]);
      const result = await fileUploadProcessor(bullJob);
      const stats = result.parseResults![0].columnStats[0];
      expect(stats.uniqueCapped).toBe(true);
      // The set stops growing after 1,001 entries (threshold is > 1000)
      expect(stats.uniqueCount).toBeGreaterThanOrEqual(1001);
    });

    it("stores up to 10 sample values per column", async () => {
      const file = makeFile("samples.csv");
      const rows = ["name"];
      for (let i = 0; i < 50; i++) rows.push(`value_${i}`);
      const content = rows.join("\n") + "\n";
      file.sizeBytes = Buffer.byteLength(content);
      setupS3ForContent(file, content);

      const bullJob = createMockBullJob([file]);
      const result = await fileUploadProcessor(bullJob);
      const stats = result.parseResults![0].columnStats[0];
      expect(stats.sampleValues.length).toBe(10);
    });
  });

  // ── Progress events ─────────────────────────────────────────────────────

  describe("Progress events", () => {
    it("emits progress=10 after S3 verification", async () => {
      const file = makeFile("progress.csv");
      const content = "name,email\nAlice,alice@test.com\n";
      file.sizeBytes = Buffer.byteLength(content);
      setupS3ForContent(file, content);

      const bullJob = createMockBullJob([file]);
      await fileUploadProcessor(bullJob);

      expect(bullJob.updateProgress).toHaveBeenCalledWith(10);
    });

    it("emits progress=30 after parsing single file", async () => {
      const file = makeFile("single.csv");
      const content = "name,email\nAlice,alice@test.com\n";
      file.sizeBytes = Buffer.byteLength(content);
      setupS3ForContent(file, content);

      const bullJob = createMockBullJob([file]);
      await fileUploadProcessor(bullJob);

      // 10 (verification) + 30 (parse: 10 + (1/1)*20 = 30)
      expect(bullJob.updateProgress).toHaveBeenCalledWith(30);
    });

    it("emits correct progress for multi-file sequential parsing", async () => {
      const files = [makeFile("a.csv"), makeFile("b.csv"), makeFile("c.csv")];
      const content = "name\nAlice\n";
      const entries = files.map((f) => {
        f.sizeBytes = Buffer.byteLength(content);
        return { file: f, content };
      });
      setupS3ForMultipleFiles(entries);

      const bullJob = createMockBullJob(files);
      await fileUploadProcessor(bullJob);

      const calls = (bullJob.updateProgress as jest.Mock).mock.calls.map(
        (c) => c[0]
      );
      // Verification: 10
      // Parse File 1: 10 + (1/3)*20 = 17
      // Parse File 2: 10 + (2/3)*20 = 23
      // Parse File 3: 10 + (3/3)*20 = 30
      // Analysis File 1: 30 + (1/3)*40 = 43
      // Analysis File 2: 30 + (2/3)*40 = 57
      // Analysis File 3: 30 + (3/3)*40 = 70
      // (Phase 4 progress is set by the worker's transition, not updateProgress)
      expect(calls).toEqual([10, 17, 23, 30, 43, 57, 70]);
    });
  });

  // ── Result shape validation ─────────────────────────────────────────────

  describe("Result shape", () => {
    it("matches FileUploadResultSchema", async () => {
      const file = makeFile("valid.csv");
      const content = "name,email\nAlice,alice@test.com\nBob,bob@test.com\n";
      file.sizeBytes = Buffer.byteLength(content);
      setupS3ForContent(file, content);

      const bullJob = createMockBullJob([file]);
      const result = await fileUploadProcessor(bullJob);

      const parsed = FileUploadResultSchema.safeParse(result);
      expect(parsed.success).toBe(true);
    });

    it("includes all expected fields in parseResults", async () => {
      const file = makeFile("fields.csv");
      const content = "name,email\nAlice,alice@test.com\n";
      file.sizeBytes = Buffer.byteLength(content);
      setupS3ForContent(file, content);

      const bullJob = createMockBullJob([file]);
      const result = await fileUploadProcessor(bullJob);
      const pr = result.parseResults![0];

      expect(pr).toHaveProperty("fileName", "fields.csv");
      expect(pr).toHaveProperty("delimiter", ",");
      expect(pr).toHaveProperty("hasHeader", true);
      expect(pr).toHaveProperty("encoding");
      expect(pr).toHaveProperty("rowCount", 1);
      expect(pr).toHaveProperty("headers", ["name", "email"]);
      expect(pr).toHaveProperty("sampleRows");
      expect(pr).toHaveProperty("columnStats");
      expect(pr.columnStats).toHaveLength(2);
    });
  });

  // ── Error paths ─────────────────────────────────────────────────────────

  describe("Error paths", () => {
    it("throws UPLOAD_PARSE_FAILED on malformed CSV (unclosed quotes)", async () => {
      const file = makeFile("malformed.csv");
      const content = 'name,email\n"Alice,alice@test.com\n';
      file.sizeBytes = Buffer.byteLength(content);
      setupS3ForContent(file, content);

      const bullJob = createMockBullJob([file]);
      await expect(fileUploadProcessor(bullJob)).rejects.toThrow(
        /Failed to parse CSV/
      );
    });

    it("throws UPLOAD_EMPTY_FILE when S3 stream yields no data", async () => {
      const file = makeFile("stream-empty.csv");
      // headObject returns non-zero size but stream is empty
      mockHeadObject.mockResolvedValue({ contentLength: 100, contentType: "text/csv" });
      // sizeBytes=0 so size check is skipped
      file.sizeBytes = 0;
      mockGetObjectStream.mockResolvedValue({
        stream: Readable.from(Buffer.alloc(0)),
        contentLength: 0,
      });

      const bullJob = createMockBullJob([file]);
      await expect(fileUploadProcessor(bullJob)).rejects.toThrow(
        /empty after download/
      );
    });

    it("throws UPLOAD_S3_READ_ERROR when getObjectStream fails", async () => {
      const file = makeFile("s3-error.csv");
      file.sizeBytes = 100;
      mockHeadObject.mockResolvedValue({ contentLength: 100, contentType: "text/csv" });
      mockGetObjectStream.mockRejectedValue(new Error("S3 connection reset"));

      const bullJob = createMockBullJob([file]);
      await expect(fileUploadProcessor(bullJob)).rejects.toThrow(
        /Failed to read file/
      );
    });
  });

  // ── Multi-file processing ───────────────────────────────────────────────

  describe("Multi-file processing", () => {
    it("produces per-file parse results sequentially", async () => {
      const files = [makeFile("contacts.csv"), makeFile("products.csv")];
      const contactsCsv = "name,email\nAlice,alice@test.com\nBob,bob@test.com\n";
      const productsCsv = "id\tname\tprice\n1\tWidget\t9.99\n";
      files[0].sizeBytes = Buffer.byteLength(contactsCsv);
      files[1].sizeBytes = Buffer.byteLength(productsCsv);

      setupS3ForMultipleFiles([
        { file: files[0], content: contactsCsv },
        { file: files[1], content: productsCsv },
      ]);

      const bullJob = createMockBullJob(files);
      const result = await fileUploadProcessor(bullJob);

      expect(result.parseResults).toHaveLength(2);
      expect(result.parseResults![0].fileName).toBe("contacts.csv");
      expect(result.parseResults![0].delimiter).toBe(",");
      expect(result.parseResults![0].rowCount).toBe(2);
      expect(result.parseResults![1].fileName).toBe("products.csv");
      expect(result.parseResults![1].delimiter).toBe("\t");
      expect(result.parseResults![1].rowCount).toBe(1);
    });
  });

  // ── XLSX support ────────────────────────────────────────────────────────

  describe("XLSX support", () => {
    it("parses a single-sheet .xlsx file and produces one parseResult", async () => {
      const file = makeFile("data.xlsx");
      const buf = await buildSingleSheetXlsx("Contacts", [
        ["name", "email"],
        ["Alice", "a@x.com"],
        ["Bob", "b@x.com"],
      ]);
      file.sizeBytes = buf.length;
      setupS3ForBinaryFiles([{ file, buffer: buf }]);

      const bullJob = createMockBullJob([file]);
      const result = await fileUploadProcessor(bullJob);

      expect(result.parseResults).toHaveLength(1);
      expect(result.parseResults![0].fileName).toBe("data.xlsx[Contacts]");
      expect(result.parseResults![0].delimiter).toBe("xlsx");
      expect(result.parseResults![0].rowCount).toBe(2);
      expect(result.parseResults![0].headers).toEqual(["name", "email"]);
    });

    it("parses a multi-sheet .xlsx and produces one parseResult per sheet", async () => {
      const file = makeFile("workbook.xlsx");
      const buf = await buildMultiSheetXlsx({
        Contacts: [["name"], ["Alice"], ["Bob"]],
        Deals: [["title"], ["d1"]],
      });
      file.sizeBytes = buf.length;
      setupS3ForBinaryFiles([{ file, buffer: buf }]);

      const bullJob = createMockBullJob([file]);
      const result = await fileUploadProcessor(bullJob);

      expect(result.parseResults!.map((r) => r.fileName)).toEqual([
        "workbook.xlsx[Contacts]",
        "workbook.xlsx[Deals]",
      ]);
      expect(result.parseResults![0].rowCount).toBe(2);
      expect(result.parseResults![1].rowCount).toBe(1);
    });

    it("calls getRecommendations once per sheet", async () => {
      const file = makeFile("multi.xlsx");
      const buf = await buildMultiSheetXlsx({
        A: [["x"], ["1"]],
        B: [["y"], ["2"]],
        C: [["z"], ["3"]],
      });
      file.sizeBytes = buf.length;
      setupS3ForBinaryFiles([{ file, buffer: buf }]);

      const bullJob = createMockBullJob([file]);
      await fileUploadProcessor(bullJob);

      expect(mockGetRecommendations).toHaveBeenCalledTimes(3);
    });

    it("derives connector instance name from XLSX filename, not sheet name", async () => {
      const file = makeFile("contacts-and-deals.xlsx");
      const buf = await buildMultiSheetXlsx({
        Contacts: [["x"], ["1"]],
        Deals: [["y"], ["2"]],
      });
      file.sizeBytes = buf.length;
      setupS3ForBinaryFiles([{ file, buffer: buf }]);

      const bullJob = createMockBullJob([file]);
      const result = await fileUploadProcessor(bullJob);

      expect(result.recommendations!.connectorInstanceName).toBe("contacts-and-deals");
    });

    it("handles mixed upload: one .csv + one .xlsx with 2 sheets → 3 parseResults", async () => {
      const csvFile = makeFile("plain.csv");
      const xlsxFile = makeFile("book.xlsx");
      const csvContent = "name,email\nAlice,a@x.com\n";
      csvFile.sizeBytes = Buffer.byteLength(csvContent);
      const xlsxBuf = await buildMultiSheetXlsx({
        S1: [["a"], ["1"]],
        S2: [["b"], ["2"]],
      });
      xlsxFile.sizeBytes = xlsxBuf.length;

      const map = new Map<string, { buf: Buffer; contentType: string }>();
      map.set(csvFile.s3Key, { buf: Buffer.from(csvContent), contentType: "text/csv" });
      map.set(xlsxFile.s3Key, { buf: xlsxBuf, contentType: "application/octet-stream" });
      mockHeadObject.mockImplementation(async (key) => {
        const e = map.get(key);
        return e ? { contentLength: e.buf.length, contentType: e.contentType } : null;
      });
      mockGetObjectStream.mockImplementation(async (key) => {
        const e = map.get(key);
        if (!e) throw new Error("Not found");
        return { stream: Readable.from(e.buf), contentLength: e.buf.length };
      });

      const bullJob = createMockBullJob([csvFile, xlsxFile]);
      const result = await fileUploadProcessor(bullJob);

      expect(result.parseResults).toHaveLength(3);
      expect(result.parseResults!.map((r) => r.fileName)).toEqual([
        "plain.csv",
        "book.xlsx[S1]",
        "book.xlsx[S2]",
      ]);
      expect(result.recommendations!.connectorInstanceName).toBe("File Import (2 files)");
    });

    it("rejects corrupt XLSX with UPLOAD_PARSE_FAILED wrapping", async () => {
      const file = makeFile("bad.xlsx");
      const buf = Buffer.from("not a valid xlsx file");
      file.sizeBytes = buf.length;
      setupS3ForBinaryFiles([{ file, buffer: buf }]);

      const bullJob = createMockBullJob([file]);
      await expect(fileUploadProcessor(bullJob)).rejects.toThrow(
        /Failed to parse XLSX file/,
      );
    });

    it("rejects XLSX with no data sheets via ProcessorError(XLSX_NO_DATA)", async () => {
      const file = makeFile("empty-sheets.xlsx");
      const buf = await buildMultiSheetXlsx({
        Empty: [],
        HeaderOnly: [["h1", "h2"]],
      });
      file.sizeBytes = buf.length;
      setupS3ForBinaryFiles([{ file, buffer: buf }]);

      const bullJob = createMockBullJob([file]);
      await expect(fileUploadProcessor(bullJob)).rejects.toMatchObject({
        name: "ProcessorError",
        code: "XLSX_NO_DATA",
      });
    });
  });
});
