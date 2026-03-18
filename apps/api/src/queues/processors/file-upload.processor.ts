import { Readable } from "node:stream";

import { parse } from "csv-parse";
import chardet from "chardet";

import type {
  FileUploadFile,
  FileParseResult,
  ColumnStat,
  FileUploadResult,
  FileUploadRecommendation,
  FileUploadRecommendationEntity,
} from "@portalai/core/models";

import type { TypedJobProcessor } from "../jobs.worker.js";
import { S3Service } from "../../services/s3.service.js";
import { DbService } from "../../services/db.service.js";
import { FileAnalysisService, type ExistingColumnDefinition } from "../../services/file-analysis.service.js";
import { createLogger } from "../../utils/logger.util.js";

const logger = createLogger({ module: "file-upload-processor" });

/** Maximum sample rows to capture per file. */
const MAX_SAMPLE_ROWS = 50;

/** Maximum unique values to track per column before marking as capped. */
const MAX_UNIQUE_VALUES = 1_000;

/** Maximum sample values to store per column stat. */
const MAX_SAMPLE_VALUES_PER_COLUMN = 10;

/** Bytes to read for delimiter/encoding detection. */
const DETECTION_CHUNK_SIZE = 4096;

// ---------------------------------------------------------------------------
// Delimiter detection
// ---------------------------------------------------------------------------

const CANDIDATE_DELIMITERS = [",", "\t", ";", "|"];

/**
 * Auto-detect the delimiter from a sample of the file.
 * Counts occurrences of each candidate in the first chunk and picks the most frequent.
 */
function detectDelimiter(sample: string): string {
  let best = ",";
  let bestCount = 0;

  for (const d of CANDIDATE_DELIMITERS) {
    const count = sample.split(d).length - 1;
    if (count > bestCount) {
      bestCount = count;
      best = d;
    }
  }
  return best;
}

// ---------------------------------------------------------------------------
// Column stat accumulator
// ---------------------------------------------------------------------------

interface ColumnAccumulator {
  name: string;
  nullCount: number;
  totalCount: number;
  uniqueValues: Set<string>;
  uniqueCapped: boolean;
  minLength: number;
  maxLength: number;
  sampleValues: string[];
}

function createAccumulator(name: string): ColumnAccumulator {
  return {
    name,
    nullCount: 0,
    totalCount: 0,
    uniqueValues: new Set(),
    uniqueCapped: false,
    minLength: Infinity,
    maxLength: 0,
    sampleValues: [],
  };
}

function updateAccumulator(acc: ColumnAccumulator, value: string): void {
  acc.totalCount++;
  const trimmed = value.trim();

  if (trimmed === "") {
    acc.nullCount++;
    return;
  }

  const len = trimmed.length;
  if (len < acc.minLength) acc.minLength = len;
  if (len > acc.maxLength) acc.maxLength = len;

  if (!acc.uniqueCapped) {
    acc.uniqueValues.add(trimmed);
    if (acc.uniqueValues.size > MAX_UNIQUE_VALUES) {
      acc.uniqueCapped = true;
    }
  }

  if (acc.sampleValues.length < MAX_SAMPLE_VALUES_PER_COLUMN) {
    acc.sampleValues.push(trimmed);
  }
}

function finalizeAccumulator(acc: ColumnAccumulator): ColumnStat {
  return {
    name: acc.name,
    nullCount: acc.nullCount,
    totalCount: acc.totalCount,
    nullRate: acc.totalCount > 0 ? acc.nullCount / acc.totalCount : 0,
    uniqueCount: acc.uniqueValues.size,
    uniqueCapped: acc.uniqueCapped,
    minLength: acc.minLength === Infinity ? 0 : acc.minLength,
    maxLength: acc.maxLength,
    sampleValues: acc.sampleValues,
  };
}

// ---------------------------------------------------------------------------
// S3 verification phase
// ---------------------------------------------------------------------------

async function verifyFiles(
  files: FileUploadFile[]
): Promise<void> {
  for (const file of files) {
    let head: { contentLength: number; contentType: string } | null;
    try {
      head = await S3Service.headObject(file.s3Key);
    } catch {
      throw new ProcessorError(
        "UPLOAD_S3_READ_ERROR",
        `Failed to read file "${file.originalName}" from S3`
      );
    }

    if (!head) {
      throw new ProcessorError(
        "UPLOAD_FILE_MISSING",
        `File "${file.originalName}" not found in S3 at key "${file.s3Key}"`
      );
    }

    if (head.contentLength === 0) {
      throw new ProcessorError(
        "UPLOAD_EMPTY_FILE",
        `File "${file.originalName}" is empty (0 bytes)`
      );
    }

    if (file.sizeBytes > 0 && head.contentLength !== file.sizeBytes) {
      throw new ProcessorError(
        "UPLOAD_FILE_SIZE_MISMATCH",
        `File "${file.originalName}" size mismatch: expected ${file.sizeBytes} bytes, got ${head.contentLength} bytes`
      );
    }
  }
}

// ---------------------------------------------------------------------------
// CSV parsing phase (single file)
// ---------------------------------------------------------------------------

async function parseFile(file: FileUploadFile): Promise<FileParseResult> {
  // Get stream from S3
  let s3Stream: Readable;
  try {
    const raw = await S3Service.getObjectStream(file.s3Key);
    s3Stream = raw.stream;
  } catch {
    throw new ProcessorError(
      "UPLOAD_S3_READ_ERROR",
      `Failed to read file "${file.originalName}" from S3`
    );
  }

  // Buffer the stream — we need the first chunk for detection, then full content for parsing
  let detectionBuffer: Buffer | null = null;
  let totalBytes = 0;
  const allChunks: Buffer[] = [];

  for await (const chunk of s3Stream as AsyncIterable<Buffer>) {
    allChunks.push(chunk);
    totalBytes += chunk.length;

    if (!detectionBuffer && totalBytes >= DETECTION_CHUNK_SIZE) {
      detectionBuffer = Buffer.concat(allChunks);
    }
  }

  const fullBuffer = Buffer.concat(allChunks);
  if (fullBuffer.length === 0) {
    throw new ProcessorError(
      "UPLOAD_EMPTY_FILE",
      `File "${file.originalName}" is empty after download`
    );
  }

  detectionBuffer = detectionBuffer ?? fullBuffer;

  // Detect encoding
  let encoding: string;
  try {
    encoding = chardet.detect(detectionBuffer) ?? "utf-8";
  } catch {
    throw new ProcessorError(
      "UPLOAD_ENCODING_ERROR",
      `Failed to detect encoding for file "${file.originalName}"`
    );
  }

  // Detect delimiter from first chunk
  const sampleText = detectionBuffer.subarray(0, DETECTION_CHUNK_SIZE).toString("utf-8");
  const delimiter = detectDelimiter(sampleText);

  // Detect if first row is a header (heuristic: if all values in first row are non-numeric strings)
  const firstLine = sampleText.split(/\r?\n/)[0] ?? "";
  const firstRowValues = firstLine.split(delimiter);
  const hasHeader = firstRowValues.length > 1 &&
    firstRowValues.every((v) => v.trim() !== "" && isNaN(Number(v.trim())));

  // Parse CSV
  const sampleRows: string[][] = [];
  const accumulators: ColumnAccumulator[] = [];
  let headers: string[] = [];
  let rowCount = 0;

  try {
    const records = await parseCSVBuffer(fullBuffer, delimiter);
    for (const record of records) {
      const values = record as string[];

      if (rowCount === 0 && hasHeader) {
        headers = values;
        // Initialize accumulators
        for (const h of headers) {
          accumulators.push(createAccumulator(h));
        }
      } else {
        // Ensure accumulators exist (for headerless files, init on first data row)
        if (accumulators.length === 0) {
          headers = values.map((_, i) => `column_${i + 1}`);
          for (const h of headers) {
            accumulators.push(createAccumulator(h));
          }
        }

        // Update stats
        for (let i = 0; i < values.length && i < accumulators.length; i++) {
          updateAccumulator(accumulators[i], values[i]);
        }

        // Capture sample rows (excluding header row)
        const dataRowIndex = hasHeader ? rowCount - 1 : rowCount;
        if (dataRowIndex < MAX_SAMPLE_ROWS) {
          sampleRows.push(values);
        }
      }

      rowCount++;
    }
  } catch (err) {
    if (err instanceof ProcessorError) throw err;
    const message = err instanceof Error ? err.message : String(err);
    throw new ProcessorError(
      "UPLOAD_PARSE_FAILED",
      `Failed to parse CSV file "${file.originalName}": ${message}`
    );
  }

  const dataRowCount = hasHeader ? rowCount - 1 : rowCount;

  return {
    fileName: file.originalName,
    delimiter,
    hasHeader,
    encoding,
    rowCount: dataRowCount,
    headers,
    sampleRows,
    columnStats: accumulators.map(finalizeAccumulator),
  };
}

/**
 * Parse a CSV buffer into an array of row arrays.
 */
async function parseCSVBuffer(
  buffer: Buffer,
  delimiter: string,
): Promise<string[][]> {
  return new Promise((resolve, reject) => {
    const rows: string[][] = [];
    const parser = parse({
      delimiter,
      relax_column_count: true,
      skip_empty_lines: true,
    });

    parser.on("readable", () => {
      let record: string[];
      while ((record = parser.read()) !== null) {
        rows.push(record);
      }
    });

    parser.on("error", reject);
    parser.on("end", () => resolve(rows));

    const stream = Readable.from(buffer);
    stream.pipe(parser);
  });
}

// ---------------------------------------------------------------------------
// Custom error class
// ---------------------------------------------------------------------------

class ProcessorError extends Error {
  code: string;
  constructor(code: string, message: string) {
    super(message);
    this.code = code;
    this.name = "ProcessorError";
  }
}

// ---------------------------------------------------------------------------
// Main processor
// ---------------------------------------------------------------------------

export const fileUploadProcessor: TypedJobProcessor<"file_upload"> = async (bullJob) => {
  const { jobId, files } = bullJob.data;
  const fileCount = files.length;

  logger.info({ jobId, fileCount }, "File upload processing started");

  // Phase 1: S3 verification (progress 0-10)
  logger.info({ jobId }, "Phase 1: Verifying files in S3");
  await verifyFiles(files);
  await bullJob.updateProgress(10);
  logger.info({ jobId }, "Phase 1 complete: All files verified");

  // Phase 2: CSV parsing (progress 10-30)
  logger.info({ jobId }, "Phase 2: Parsing CSV files");
  const parseResults: FileParseResult[] = [];

  for (let i = 0; i < fileCount; i++) {
    const file = files[i];
    logger.info({ jobId, fileName: file.originalName }, `Parsing file ${i + 1}/${fileCount}`);

    const result = await parseFile(file);
    parseResults.push(result);

    // Byte-based progress: 10 + ((i+1) / fileCount) * 20
    const progress = Math.round(10 + ((i + 1) / fileCount) * 20);
    await bullJob.updateProgress(progress);

    logger.info(
      { jobId, fileName: file.originalName, rowCount: result.rowCount, delimiter: result.delimiter },
      `Parsed file ${i + 1}/${fileCount}`
    );
  }

  logger.info({ jobId }, "Phase 2 complete: All files parsed");

  // Phase 3: AI analysis (progress 30-70)
  logger.info({ jobId }, "Phase 3: Analyzing files with AI");

  const organizationId = bullJob.data.organizationId;

  // Fetch existing column definitions for the organization
  const existingColumnDefs = await DbService.repository.columnDefinitions
    .findByOrganizationId(organizationId);
  const existingColumns: ExistingColumnDefinition[] = existingColumnDefs.map((cd) => ({
    id: cd.id,
    key: cd.key,
    label: cd.label,
    type: cd.type,
  }));

  const entityRecommendations: FileUploadRecommendationEntity[] = [];

  for (let i = 0; i < parseResults.length; i++) {
    const parseResult = parseResults[i];
    logger.info(
      { jobId, fileName: parseResult.fileName },
      `Analyzing file ${i + 1}/${parseResults.length}`
    );

    const recommendation = await FileAnalysisService.getRecommendations({
      parseResult,
      existingColumns,
      priorRecommendations: entityRecommendations,
    });

    entityRecommendations.push(recommendation);

    // Progress: 30 + ((i+1) / fileCount) * 40 (maps to 30-70 range)
    const progress = Math.round(30 + ((i + 1) / fileCount) * 40);
    await bullJob.updateProgress(progress);

    logger.info(
      { jobId, fileName: parseResult.fileName, columnCount: recommendation.columns.length },
      `Analyzed file ${i + 1}/${parseResults.length}`
    );
  }

  logger.info({ jobId }, "Phase 3 complete: All files analyzed");

  // Phase 4: Assemble recommendations and persist (progress 70-80)
  logger.info({ jobId }, "Phase 4: Persisting recommendations");

  // Derive a suggested connector instance name from file names
  const connectorInstanceName = parseResults.length === 1
    ? parseResults[0].fileName.replace(/\.[^.]+$/, "")
    : `CSV Import (${parseResults.length} files)`;

  const recommendations: FileUploadRecommendation = {
    connectorInstanceName,
    entities: entityRecommendations,
  };

  logger.info({ jobId }, "Phase 4 complete: Recommendations assembled");

  const result: FileUploadResult = { parseResults, recommendations };
  return result;
};
