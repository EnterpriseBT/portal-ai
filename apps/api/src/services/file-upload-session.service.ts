/**
 * Orchestrates the presigned-URL streaming upload pipeline
 * (see docs/LARGE_WORKBOOK_STREAMING.plan.md §Phase 1–3b).
 *
 * Owns:
 *   - `presign` — mints uploadIds + presigned PUT URLs, creates `file_uploads`
 *     rows in status `"pending"`.
 *   - `confirm` — HEADs the S3 object to verify the client's PUT succeeded,
 *     transitions the row to `"uploaded"`.
 *   - `parseSession` — streams every upload in a session from S3, merges the
 *     sheets, caches the result in Redis, and transitions rows to
 *     `"parsed"`. Returns a client-facing preview (inline cells or a slice
 *     flag per the inline-cells threshold).
 *   - `sheetSlice` — serves cell rectangles from the cached workbook for
 *     sheets over the inline cap.
 *   - `resolveWorkbook` — used by the layout-plan endpoints to look up a
 *     parsed workbook by session id, falling back to re-stream on cache miss.
 */

import { Readable } from "node:stream";

import { and, inArray, lt } from "drizzle-orm";

import { fileUploads } from "../db/schema/index.js";

import type {
  FileUploadParseSessionResponsePayload,
  FileUploadPresignFile,
  FileUploadPresignResponsePayload,
  FileUploadSheetSliceResponsePayload,
} from "@portalai/core/contracts";
import type { WorkbookData } from "@portalai/spreadsheet-parsing";
import { WorkbookSchema } from "@portalai/spreadsheet-parsing";

import { ApiCode } from "../constants/api-codes.constants.js";
import { environment } from "../environment.js";
import { ApiError } from "./http.service.js";
import { DbService } from "./db.service.js";
import { S3Service } from "./s3.service.js";
import { WorkbookCacheService } from "./workbook-cache.service.js";
import {
  findSheetById,
  inflateSheetPreview,
  sliceWorkbookRectangle,
  type PreviewSheet,
} from "../utils/workbook-preview.util.js";

/**
 * Cache key for an upload-session-scoped workbook. The cache service is
 * shared with OAuth-driven connectors (`connector:wb:<slug>:{id}` — see
 * `utils/connector-cache-keys.util.ts`); this prefix lives here so the
 * file-upload pipeline owns its namespace.
 */
function uploadSessionCacheKey(uploadSessionId: string): string {
  return `upload-session:${uploadSessionId}`;
}

import { csvToWorkbook } from "./workbook-adapters/csv.adapter.js";
import { xlsxToWorkbook } from "./workbook-adapters/xlsx.adapter.js";
import { ProcessorError } from "../utils/processor-error.util.js";
import { SystemUtilities } from "../utils/system.util.js";
import { createLogger } from "../utils/logger.util.js";
import type { FileUploadSelect } from "../db/schema/zod.js";

const logger = createLogger({ module: "file-upload-session" });

const SUPPORTED_EXTENSIONS = [".csv", ".tsv", ".xlsx", ".xls"] as const;
type SupportedExtension = (typeof SUPPORTED_EXTENSIONS)[number];

function extensionOf(filename: string): string {
  const dot = filename.lastIndexOf(".");
  if (dot < 0 || dot === filename.length - 1) return "";
  return filename.substring(dot).toLowerCase();
}

function baseNameOf(filename: string): string {
  const dot = filename.lastIndexOf(".");
  const base = dot > 0 ? filename.substring(0, dot) : filename;
  return base.length > 0 ? base : "Sheet1";
}

function ensureBucketConfigured(): void {
  if (!environment.UPLOAD_S3_BUCKET) {
    throw new ApiError(
      500,
      ApiCode.FILE_UPLOAD_S3_CONFIG_MISSING,
      "UPLOAD_S3_BUCKET is not configured"
    );
  }
}

function uniqueSheetName(name: string, taken: Set<string>): string {
  if (!taken.has(name)) return name;
  let suffix = 2;
  while (suffix < 1_000) {
    const candidate = `${name} (${suffix})`;
    if (!taken.has(candidate)) return candidate;
    suffix += 1;
  }
  throw new Error(`Could not generate unique sheet name for "${name}"`);
}

// Preview shape helpers (sheetId / coerceToPreviewCell / inflateSheetPreview /
// findSheetById / sliceWorkbookRectangle) live in `utils/workbook-preview.util.ts`
// — shared with the google-sheets pipeline.

async function parseSingle(
  stream: Readable,
  filename: string
): Promise<WorkbookData> {
  const ext = extensionOf(filename);
  if (!SUPPORTED_EXTENSIONS.includes(ext as SupportedExtension)) {
    throw new ApiError(
      400,
      ApiCode.FILE_UPLOAD_PARSE_UNSUPPORTED,
      `Unsupported file extension "${ext || "(none)"}" on "${filename}"`
    );
  }
  try {
    if (ext === ".csv" || ext === ".tsv") {
      return await csvToWorkbook(stream, {
        sheetName: baseNameOf(filename),
        delimiter: ext === ".tsv" ? "\t" : undefined,
      });
    }
    return await xlsxToWorkbook(stream);
  } catch (err) {
    if (err instanceof ApiError) throw err;
    if (err instanceof ProcessorError) {
      throw new ApiError(
        400,
        ApiCode.FILE_UPLOAD_PARSE_FAILED,
        err.message
      );
    }
    throw new ApiError(
      500,
      ApiCode.FILE_UPLOAD_PARSE_FAILED,
      err instanceof Error ? err.message : "Failed to parse file"
    );
  }
}

/**
 * Stream all uploads referenced by a session, parse them, and merge into a
 * single `WorkbookData` with unique sheet names. Shared between
 * `parseSession` (fresh parse) and `resolveWorkbook` (cache-miss refill).
 */
async function parseUploadsToWorkbook(
  uploads: FileUploadSelect[]
): Promise<WorkbookData> {
  const merged: WorkbookData["sheets"] = [];
  const taken = new Set<string>();
  for (const upload of uploads) {
    const { stream } = await S3Service.getObjectStream(upload.s3Key);
    const workbook = await parseSingle(stream, upload.filename);
    for (const sheet of workbook.sheets) {
      const name = uniqueSheetName(sheet.name, taken);
      taken.add(name);
      merged.push({ ...sheet, name });
    }
  }
  const workbook: WorkbookData = { sheets: merged };
  const validated = WorkbookSchema.safeParse(workbook);
  if (!validated.success) {
    throw new ApiError(
      500,
      ApiCode.FILE_UPLOAD_PARSE_FAILED,
      "Adapter produced an invalid workbook"
    );
  }
  return validated.data;
}

export const FileUploadSessionService = {
  // ── Phase 1: presign ────────────────────────────────────────────────

  async presign(
    organizationId: string,
    userId: string,
    files: FileUploadPresignFile[]
  ): Promise<FileUploadPresignResponsePayload> {
    ensureBucketConfigured();

    if (files.length > environment.UPLOAD_MAX_FILES_PER_SESSION) {
      throw new ApiError(
        400,
        ApiCode.FILE_UPLOAD_TOO_MANY_FILES,
        `Max ${environment.UPLOAD_MAX_FILES_PER_SESSION} files per upload session`
      );
    }

    for (const file of files) {
      const ext = extensionOf(file.fileName);
      if (!environment.UPLOAD_ALLOWED_EXTENSIONS.includes(ext)) {
        throw new ApiError(
          400,
          ApiCode.FILE_UPLOAD_PARSE_UNSUPPORTED,
          `Unsupported extension "${ext || "(none)"}" on "${file.fileName}"`
        );
      }
      if (file.sizeBytes > environment.UPLOAD_MAX_FILE_SIZE_BYTES) {
        throw new ApiError(
          413,
          ApiCode.FILE_UPLOAD_PARSE_TOO_LARGE,
          `"${file.fileName}" (${file.sizeBytes} bytes) exceeds ${environment.UPLOAD_MAX_FILE_SIZE_BYTES}`
        );
      }
    }

    const expiresAt = Date.now() + environment.UPLOAD_S3_PRESIGN_EXPIRY_SEC * 1000;
    const uploads: FileUploadPresignResponsePayload["uploads"] = [];

    for (const file of files) {
      const uploadId = SystemUtilities.id.v4.generate();
      const s3Key = `${environment.UPLOAD_S3_PREFIX}/${organizationId}/${uploadId}/${file.fileName}`;
      const putUrl = await S3Service.createPresignedPutUrl(
        s3Key,
        file.contentType,
        environment.UPLOAD_S3_PRESIGN_EXPIRY_SEC
      );
      await DbService.repository.fileUploads.create({
        id: uploadId,
        organizationId,
        filename: file.fileName,
        contentType: file.contentType,
        sizeBytes: file.sizeBytes,
        s3Key,
        status: "pending",
        uploadSessionId: null,
        created: Date.now(),
        createdBy: userId,
        updated: null,
        updatedBy: null,
        deleted: null,
        deletedBy: null,
      });
      uploads.push({ uploadId, s3Key, putUrl, expiresAt });
    }

    logger.info(
      {
        organizationId,
        fileCount: files.length,
        totalBytes: files.reduce((acc, f) => acc + f.sizeBytes, 0),
        event: "upload.presign.issued",
      },
      "Presigned URLs issued"
    );
    return { uploads };
  },

  // ── Phase 2: confirm ────────────────────────────────────────────────

  async confirm(
    organizationId: string,
    uploadId: string
  ): Promise<{ uploadId: string; status: "uploaded"; sizeBytes: number }> {
    const row = await DbService.repository.fileUploads.findById(uploadId);
    if (!row) {
      throw new ApiError(
        404,
        ApiCode.FILE_UPLOAD_NOT_FOUND,
        `Upload ${uploadId} not found`
      );
    }
    if (row.organizationId !== organizationId) {
      throw new ApiError(
        403,
        ApiCode.FILE_UPLOAD_FORBIDDEN,
        "Upload does not belong to this organization"
      );
    }
    if (row.status === "uploaded") {
      // Idempotent — still verify the object is actually there.
      const head = await S3Service.headObject(row.s3Key);
      if (!head) {
        throw new ApiError(
          409,
          ApiCode.FILE_UPLOAD_S3_NOT_PRESENT,
          "Upload row says uploaded but S3 object missing"
        );
      }
      return {
        uploadId: row.id,
        status: "uploaded",
        sizeBytes: head.contentLength,
      };
    }
    if (row.status !== "pending") {
      throw new ApiError(
        409,
        ApiCode.FILE_UPLOAD_INVALID_STATE,
        `Cannot confirm upload in status "${row.status}"`
      );
    }

    const head = await S3Service.headObject(row.s3Key);
    if (!head) {
      throw new ApiError(
        409,
        ApiCode.FILE_UPLOAD_S3_NOT_PRESENT,
        "S3 object not present — PUT may not have completed"
      );
    }

    await DbService.repository.fileUploads.updateStatus(row.id, "uploaded", {});
    logger.info(
      {
        uploadId,
        organizationId,
        sizeBytes: head.contentLength,
        event: "upload.confirmed",
      },
      "Upload confirmed"
    );
    return {
      uploadId: row.id,
      status: "uploaded",
      sizeBytes: head.contentLength,
    };
  },

  // ── Phase 3: parse session ──────────────────────────────────────────

  async parseSession(
    organizationId: string,
    uploadIds: string[]
  ): Promise<FileUploadParseSessionResponsePayload> {
    if (uploadIds.length === 0) {
      throw new ApiError(
        400,
        ApiCode.FILE_UPLOAD_PARSE_INVALID_PAYLOAD,
        "At least one uploadId is required"
      );
    }

    const rows = await Promise.all(
      uploadIds.map((id) => DbService.repository.fileUploads.findById(id))
    );
    const uploads: FileUploadSelect[] = [];
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const id = uploadIds[i];
      if (!row) {
        throw new ApiError(
          404,
          ApiCode.FILE_UPLOAD_NOT_FOUND,
          `Upload ${id} not found`
        );
      }
      if (row.organizationId !== organizationId) {
        throw new ApiError(
          403,
          ApiCode.FILE_UPLOAD_FORBIDDEN,
          `Upload ${id} belongs to a different organization`
        );
      }
      if (row.status !== "uploaded" && row.status !== "parsed") {
        throw new ApiError(
          409,
          ApiCode.FILE_UPLOAD_INVALID_STATE,
          `Upload ${id} is in status "${row.status}"; must be "uploaded" to parse`
        );
      }
      uploads.push(row);
    }

    const started = Date.now();
    const workbook = await parseUploadsToWorkbook(uploads);

    const uploadSessionId = SystemUtilities.id.v4.generate();
    await WorkbookCacheService.set(uploadSessionCacheKey(uploadSessionId), workbook);
    await DbService.repository.fileUploads.updateStatusMany(
      uploads.map((u) => u.id),
      "parsed",
      { uploadSessionId }
    );

    const inlineCellsMax = environment.FILE_UPLOAD_INLINE_CELLS_MAX;
    let sliced = false;
    const sheets: PreviewSheet[] = workbook.sheets.map((sheet, i) => {
      const inflated = inflateSheetPreview(sheet, i, inlineCellsMax);
      if (inflated.sliced) sliced = true;
      return inflated.sheet;
    });

    logger.info(
      {
        organizationId,
        uploadSessionId,
        fileCount: uploads.length,
        sheetCount: workbook.sheets.length,
        sliced,
        durationMs: Date.now() - started,
        event: "upload.parse.completed",
      },
      "Parse session completed"
    );

    return { uploadSessionId, sheets, sliced: sliced || undefined };
  },

  // ── Phase 3b: sheet slice ──────────────────────────────────────────

  async sheetSlice(
    organizationId: string,
    query: {
      uploadSessionId: string;
      sheetId: string;
      rowStart: number;
      rowEnd: number;
      colStart: number;
      colEnd: number;
    }
  ): Promise<FileUploadSheetSliceResponsePayload> {
    const workbook = await this.resolveWorkbook(
      query.uploadSessionId,
      organizationId
    );
    const match = findSheetById(workbook, query.sheetId);
    if (!match) {
      throw new ApiError(
        404,
        ApiCode.FILE_UPLOAD_SLICE_OUT_OF_BOUNDS,
        `Sheet ${query.sheetId} not present in session ${query.uploadSessionId}`
      );
    }
    return sliceWorkbookRectangle(match.sheet, query);
  },

  // ── Shared: resolve workbook for interpret/commit ──────────────────

  async resolveWorkbook(
    uploadSessionId: string,
    organizationId: string
  ): Promise<WorkbookData> {
    const cached = await WorkbookCacheService.get(
      uploadSessionCacheKey(uploadSessionId)
    );
    if (cached) return cached;

    // Cache miss — re-stream from S3 using the file_uploads rows keyed to
    // this session.
    const uploads =
      await DbService.repository.fileUploads.findByUploadSessionId(
        uploadSessionId
      );
    if (uploads.length === 0) {
      throw new ApiError(
        404,
        ApiCode.FILE_UPLOAD_SESSION_NOT_FOUND,
        `Upload session ${uploadSessionId} not found`
      );
    }
    for (const upload of uploads) {
      if (upload.organizationId !== organizationId) {
        throw new ApiError(
          403,
          ApiCode.FILE_UPLOAD_FORBIDDEN,
          "Upload session belongs to a different organization"
        );
      }
    }
    logger.info(
      { uploadSessionId, event: "upload.cache.miss" },
      "Re-streaming workbook from S3 (cache miss)"
    );
    const workbook = await parseUploadsToWorkbook(uploads);
    await WorkbookCacheService.set(uploadSessionCacheKey(uploadSessionId), workbook);
    return workbook;
  },

  /**
   * Sweep stale `file_uploads` rows — any row older than
   * `stalenessMs` in a non-`"committed"` state (`pending`, `uploaded`,
   * `parsed`, `failed`) is soft-deleted + its S3 object is best-effort
   * deleted. Called at app startup; safe to invoke more than once.
   *
   * The S3 bucket-level lifecycle rule is the durability guarantee; this
   * sweeper is a fast UI-visible cleanup so abandoned draft rows don't
   * show up in future admin views.
   */
  async sweepStaleUploads(
    stalenessMs: number = 24 * 60 * 60 * 1000,
    now: number = Date.now()
  ): Promise<{ swept: number }> {
    const cutoff = now - stalenessMs;
    const staleStatuses: FileUploadSelect["status"][] = [
      "pending",
      "uploaded",
      "parsed",
      "failed",
    ];
    const rows = await DbService.repository.fileUploads.findMany(
      and(
        lt(fileUploads.created, cutoff),
        inArray(fileUploads.status, staleStatuses)
      )
    );
    if (rows.length === 0) return { swept: 0 };

    logger.info(
      { count: rows.length, cutoff, event: "upload.sweep.started" },
      "Sweeping stale file_uploads"
    );
    for (const row of rows) {
      S3Service.deleteObject(row.s3Key).catch((err) => {
        logger.warn(
          {
            s3Key: row.s3Key,
            err: err instanceof Error ? err.message : err,
          },
          "Sweeper: failed to delete S3 object"
        );
      });
    }
    await DbService.repository.fileUploads.softDeleteMany(
      rows.map((r) => r.id),
      "SWEEPER"
    );
    return { swept: rows.length };
  },

  /**
   * Mark a session's rows committed and best-effort delete the S3 objects.
   * Called by the commit pipeline on success.
   */
  async markSessionCommitted(uploadSessionId: string): Promise<void> {
    const uploads =
      await DbService.repository.fileUploads.findByUploadSessionId(
        uploadSessionId
      );
    if (uploads.length === 0) return;
    await DbService.repository.fileUploads.updateStatusMany(
      uploads.map((u) => u.id),
      "committed",
      {}
    );
    await WorkbookCacheService.delete(uploadSessionCacheKey(uploadSessionId));
    // Fire-and-forget S3 deletes; residual objects are also swept by the
    // bucket lifecycle rule.
    for (const upload of uploads) {
      S3Service.deleteObject(upload.s3Key).catch((err) => {
        logger.warn(
          { s3Key: upload.s3Key, err: err instanceof Error ? err.message : err },
          "Failed to delete S3 object on commit"
        );
      });
    }
  },
};
