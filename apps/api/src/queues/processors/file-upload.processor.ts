import path from "node:path";
import type { Readable } from "node:stream";

import type {
  FileUploadFile,
  FileParseResult,
  FileUploadResult,
  FileUploadRecommendation,
  FileUploadRecommendationEntity,
} from "@portalai/core/models";

import type { TypedJobProcessor } from "../jobs.worker.js";
import { S3Service } from "../../services/s3.service.js";
import { DbService } from "../../services/db.service.js";
import {
  FileAnalysisService,
  type ExistingColumnDefinition,
} from "../../services/file-analysis.service.js";
import { createLogger } from "../../utils/logger.util.js";
import { parseCsvStream } from "../../utils/csv-parser.util.js";
import { parseXlsxStream } from "../../utils/xlsx-parser.util.js";
import { ProcessorError } from "../../utils/processor-error.util.js";

const logger = createLogger({ module: "file-upload-processor" });

/** Maximum sample rows to capture per file. */
const MAX_SAMPLE_ROWS = 50;

// ---------------------------------------------------------------------------
// S3 verification phase
// ---------------------------------------------------------------------------

async function verifyFiles(files: FileUploadFile[]): Promise<void> {
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
// File parsing phase (streaming, format-specific)
// ---------------------------------------------------------------------------

/**
 * Stream a file from S3 and produce one or more FileParseResults.
 * CSV files always yield a single element; XLSX files yield one element per
 * non-empty sheet, with `fileName` encoded as `<originalName>[<SheetName>]`.
 */
async function parseFile(file: FileUploadFile): Promise<FileParseResult[]> {
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

  const extension = path.extname(file.originalName).toLowerCase();

  if (extension === ".xlsx") {
    try {
      const results: FileParseResult[] = [];
      for await (const result of parseXlsxStream(s3Stream, {
        fileName: file.originalName,
        maxSampleRows: MAX_SAMPLE_ROWS,
      })) {
        results.push(result);
      }
      if (results.length === 0) {
        throw new ProcessorError(
          "XLSX_NO_DATA",
          `XLSX file "${file.originalName}" contains no sheets with data`
        );
      }
      return results;
    } catch (err) {
      if (err instanceof ProcessorError) throw err;
      const message = err instanceof Error ? err.message : String(err);
      throw new ProcessorError(
        "UPLOAD_PARSE_FAILED",
        `Failed to parse XLSX file "${file.originalName}": ${message}`
      );
    }
  }

  try {
    const result = await parseCsvStream(s3Stream, {
      fileName: file.originalName,
      maxSampleRows: MAX_SAMPLE_ROWS,
    });

    // Defensive: S3 reported size>0 but stream yielded nothing
    if (result.headers.length === 0 && result.rowCount === 0) {
      throw new ProcessorError(
        "UPLOAD_EMPTY_FILE",
        `File "${file.originalName}" is empty after download`
      );
    }

    return [result];
  } catch (err) {
    if (err instanceof ProcessorError) throw err;
    const message = err instanceof Error ? err.message : String(err);
    throw new ProcessorError(
      "UPLOAD_PARSE_FAILED",
      `Failed to parse CSV file "${file.originalName}": ${message}`
    );
  }
}

// ---------------------------------------------------------------------------
// Main processor
// ---------------------------------------------------------------------------

export const fileUploadProcessor: TypedJobProcessor<"file_upload"> = async (
  bullJob
) => {
  const { jobId, files } = bullJob.data;
  const fileCount = files.length;

  logger.info({ jobId, fileCount }, "File upload processing started");

  // Phase 1: S3 verification (progress 0-10)
  logger.info({ jobId }, "Phase 1: Verifying files in S3");
  await verifyFiles(files);
  await bullJob.updateProgress(10);
  logger.info({ jobId }, "Phase 1 complete: All files verified");

  // Phase 2: File parsing (progress 10-30)
  logger.info({ jobId }, "Phase 2: Parsing files");
  const parseResults: FileParseResult[] = [];

  for (let i = 0; i < fileCount; i++) {
    const file = files[i];
    logger.info(
      { jobId, fileName: file.originalName },
      `Parsing file ${i + 1}/${fileCount}`
    );

    const fileResults = await parseFile(file);
    for (const result of fileResults) {
      parseResults.push(result);
      logger.info(
        {
          jobId,
          fileName: result.fileName,
          rowCount: result.rowCount,
          delimiter: result.delimiter,
        },
        `Parsed ${result.fileName}`
      );
    }

    // Byte-based progress: 10 + ((i+1) / fileCount) * 20
    const progress = Math.round(10 + ((i + 1) / fileCount) * 20);
    await bullJob.updateProgress(progress);
  }

  logger.info({ jobId }, "Phase 2 complete: All files parsed");

  // Phase 3: AI analysis (progress 30-70)
  logger.info({ jobId }, "Phase 3: Analyzing files with AI");

  const organizationId = bullJob.data.organizationId;

  // Fetch existing column definitions for the organization
  const existingColumnDefs =
    await DbService.repository.columnDefinitions.findByOrganizationId(
      organizationId
    );
  const existingColumns: ExistingColumnDefinition[] = existingColumnDefs.map(
    (cd) => ({
      id: cd.id,
      key: cd.key,
      label: cd.label,
      type: cd.type,
      description: cd.description ?? null,
      validationPattern: cd.validationPattern ?? null,
      canonicalFormat: cd.canonicalFormat ?? null,
    })
  );

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

    // Progress: 30 + ((i+1) / parseResults.length) * 40 (maps to 30-70 range)
    const progress = Math.round(30 + ((i + 1) / parseResults.length) * 40);
    await bullJob.updateProgress(progress);

    logger.info(
      {
        jobId,
        fileName: parseResult.fileName,
        columnCount: recommendation.columns.length,
      },
      `Analyzed file ${i + 1}/${parseResults.length}`
    );
  }

  logger.info({ jobId }, "Phase 3 complete: All files analyzed");

  // Phase 4: Assemble recommendations and persist (progress 70-80)
  logger.info({ jobId }, "Phase 4: Persisting recommendations");

  // Derive a suggested connector instance name from the uploaded files.
  // Use the file count (not parseResults.length) so a single XLSX with N sheets
  // yields a workbook-based name rather than "(N files)".
  const connectorInstanceName =
    fileCount === 1
      ? files[0].originalName.replace(/\.[^.]+$/, "")
      : `File Import (${fileCount} files)`;

  const recommendations: FileUploadRecommendation = {
    connectorInstanceName,
    entities: entityRecommendations,
  };

  logger.info({ jobId }, "Phase 4 complete: Recommendations assembled");

  const result: FileUploadResult = { parseResults, recommendations };
  return result;
};
