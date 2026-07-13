/**
 * Orchestrates the presigned-URL streaming upload pipeline
 * (see docs/LARGE_WORKBOOK_STREAMING.plan.md §Phase 1–3b).
 *
 * Owns:
 *   - `presign` — mints uploadIds + presigned PUT URLs, creates `file_uploads`
 *     rows in status `"pending"`.
 *   - `confirm` — HEADs the S3 object to verify the client's PUT succeeded,
 *     transitions the row to `"uploaded"`.
 *   - `parseSession` — streams every upload in a session from S3 directly
 *     into the chunked Redis cache (see workbook-cache.service.ts and
 *     docs/LARGE_FILE_PARSE_STREAMING.plan.md). Transitions rows to
 *     `"parsed"`. Returns a client-facing preview (inline cells or a
 *     slice flag per the inline-cells threshold).
 *   - `sheetSlice` — serves cell rectangles by pulling row-chunks from the
 *     chunked cache, no full-sheet load.
 *   - `resolveWorkbook` — used by the layout-plan endpoints to look up a
 *     parsed workbook by session id, falling back to re-parse on cache
 *     miss. Reassembles `WorkbookData` from chunks for legacy consumers.
 */

import { and, inArray, lt } from "drizzle-orm";

import { fileUploads } from "../db/schema/index.js";

import type {
  FileUploadParseJobResult,
  FileUploadParseSessionResponsePayload,
  FileUploadPresignFile,
  FileUploadPresignResponsePayload,
  FileUploadSheetSliceResponsePayload,
} from "@portalai/core/contracts";
import type { Workbook } from "@portalai/spreadsheet-parsing";

import { ApiCode } from "../constants/api-codes.constants.js";
import { environment } from "../environment.js";
import { ApiError } from "./http.service.js";
import { DbService } from "./db.service.js";
import { JobsService } from "./jobs.service.js";
import { S3Service } from "./s3.service.js";
import {
  WorkbookCacheService,
  type SessionWriter,
} from "./workbook-cache.service.js";
import {
  findSheetMetaById,
  inflateSheetPreviewFromChunks,
  sheetId as makeSheetId,
  sliceSheetRectangleFromChunks,
  type PreviewSheet,
} from "../utils/workbook-preview.util.js";
import { makeLazyWorkbookFromCache } from "../utils/lazy-workbook.util.js";

import { csvToCache } from "./workbook-adapters/csv.adapter.js";
import { xlsxToCache } from "./workbook-adapters/xlsx.adapter.js";
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

/**
 * Cache prefix for an upload-session-scoped chunked workbook. Sibling key
 * shapes (rows, merges, meta) live underneath this prefix — see
 * `workbook-cache.service.ts`.
 */
function uploadSessionCachePrefix(uploadSessionId: string): string {
  return `upload-session:${uploadSessionId}`;
}

interface ParsedSheetMeta {
  sheetId: string;
  name: string;
  rowCount: number;
  colCount: number;
}

/**
 * Stream a single upload into the chunked cache, returning the metadata
 * for each sheet it produced. Multi-sheet sources (xlsx) yield more than
 * one entry; CSV/TSV always yields exactly one.
 */
async function parseUploadIntoCache(
  upload: FileUploadSelect,
  writer: SessionWriter,
  taken: Set<string>,
  sheetIndexOffset: number,
  onRowsFlushed?: (rowsThisFlush: number) => void
): Promise<ParsedSheetMeta[]> {
  const ext = extensionOf(upload.filename);
  if (!SUPPORTED_EXTENSIONS.includes(ext as SupportedExtension)) {
    throw new ApiError(
      400,
      ApiCode.FILE_UPLOAD_PARSE_UNSUPPORTED,
      `Unsupported file extension "${ext || "(none)"}" on "${upload.filename}"`
    );
  }

  const { stream } = await S3Service.getObjectStream(upload.s3Key);

  try {
    if (ext === ".csv" || ext === ".tsv") {
      const baseName = baseNameOf(upload.filename);
      const name = uniqueSheetName(baseName, taken);
      taken.add(name);
      const sId = makeSheetId(sheetIndexOffset, name);
      const stats = await csvToCache(stream, sId, writer, {
        delimiter: ext === ".tsv" ? "\t" : undefined,
        onRowsFlushed,
      });
      await writer.finishSheet(sId, {
        name,
        rowCount: stats.rowCount,
        colCount: stats.colCount,
      });
      return [{ sheetId: sId, name, ...stats }];
    }

    // XLSX/XLS — streamed via ExcelJS' WorkbookReader. The adapter calls
    // back into `resolveSheet` so name uniqueness + sheet-id minting stay
    // here, where the file-upload pipeline owns the policy.
    let nextOffset = sheetIndexOffset;
    return await xlsxToCache(stream, writer, {
      resolveSheet: (rawName) => {
        const name = uniqueSheetName(rawName, taken);
        taken.add(name);
        const sId = makeSheetId(nextOffset, name);
        nextOffset++;
        return { name, sheetId: sId };
      },
      onRowsFlushed,
    });
  } catch (err) {
    if (err instanceof ApiError) throw err;
    if (err instanceof ProcessorError) {
      throw new ApiError(400, ApiCode.FILE_UPLOAD_PARSE_FAILED, err.message);
    }
    throw new ApiError(
      500,
      ApiCode.FILE_UPLOAD_PARSE_FAILED,
      err instanceof Error ? err.message : "Failed to parse file"
    );
  }
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
        const formatMB = (bytes: number): string =>
          `${(bytes / 1024 / 1024).toFixed(1)} MB`;
        throw new ApiError(
          413,
          ApiCode.FILE_UPLOAD_PARSE_TOO_LARGE,
          `"${file.fileName}" is ${formatMB(file.sizeBytes)}, which exceeds the ${formatMB(environment.UPLOAD_MAX_FILE_SIZE_BYTES)} per-file upload limit.`,
          {
            fileName: file.fileName,
            sizeBytes: file.sizeBytes,
            capBytes: environment.UPLOAD_MAX_FILE_SIZE_BYTES,
          }
        );
      }
    }

    const expiresAt =
      Date.now() + environment.UPLOAD_S3_PRESIGN_EXPIRY_SEC * 1000;
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

  // ── Phase 3: parse session (enqueue) ────────────────────────────────

  /**
   * Validate the upload set against the DB, mint an `uploadSessionId`,
   * and enqueue a `file_upload_parse` job. Returns 202-style metadata
   * the route hands straight to the client; the actual parse work runs
   * out-of-band in `runParseSession` (called by the processor) and is
   * delivered to the client over `/api/sse/jobs/:id/events`.
   *
   * Pre-flight validation lives here — not in the worker — so the
   * client gets immediate 4xx feedback for bad upload ids /
   * cross-organization access / invalid status, instead of a
   * fast-failing job they have to chase via SSE.
   */
  async parseSession(
    organizationId: string,
    userId: string,
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
    }

    const uploadSessionId = SystemUtilities.id.v4.generate();
    const job = await JobsService.create(userId, {
      organizationId,
      type: "file_upload_parse",
      metadata: { organizationId, uploadSessionId, uploadIds },
    });

    logger.info(
      {
        organizationId,
        uploadSessionId,
        jobId: job.id,
        fileCount: uploadIds.length,
        event: "upload.parse.enqueued",
      },
      "Parse session enqueued"
    );

    return { uploadSessionId, jobId: job.id, status: "pending" };
  },

  // ── Phase 3: parse session (worker body) ────────────────────────────

  /**
   * The actual parse loop, called from the `file_upload_parse`
   * processor. Drives every upload through the streaming adapters
   * straight into the chunked cache, finalizes the cache session, then
   * builds the inline-preview payload the client used to receive
   * synchronously from `/parse`. Returns the payload as the job's
   * `result` so it lands on the SSE terminal-event for the awaiting
   * frontend.
   *
   * Re-entrant: re-running the same `(uploadSessionId, uploadIds)`
   * tuple is safe — it overwrites the chunked cache and re-runs the
   * status update on the file_uploads rows.
   */
  async runParseSession(
    organizationId: string,
    uploadSessionId: string,
    uploadIds: string[],
    onProgress?: (percent: number) => void
  ): Promise<FileUploadParseJobResult> {
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
    const prefix = uploadSessionCachePrefix(uploadSessionId);

    // Pre-validation done — kick the progress bar off zero so the UI
    // shows movement the moment the worker picks the job up.
    onProgress?.(5);

    // We don't know total rows in advance (streaming parse, no
    // pre-flight count), so map row-flush events to a 5..85 bar
    // using a 4000-rows-per-percent ramp. Caps at 85 so the bar
    // never reads "done" before `writer.finalize` lands at 90 and
    // the worker auto-emits 100 on completion. Throttled to
    // 5-point buckets so a ~100-flush parse fires ~16 SSE events
    // rather than ~100.
    const PROGRESS_AFTER_PREFLIGHT = 5;
    const PROGRESS_PRE_FINALIZE_CAP = 85;
    const ROWS_PER_PERCENT = 4000;
    let totalRowsFlushed = 0;
    let lastBucket = -1;
    const reportRowsFlushed = (rowsThisFlush: number): void => {
      if (!onProgress) return;
      totalRowsFlushed += rowsThisFlush;
      const raw =
        PROGRESS_AFTER_PREFLIGHT +
        Math.floor(totalRowsFlushed / ROWS_PER_PERCENT);
      const percent = Math.min(PROGRESS_PRE_FINALIZE_CAP, raw);
      const bucket = Math.floor(percent / 5);
      if (bucket > lastBucket) {
        lastBucket = bucket;
        onProgress(percent);
      }
    };

    const writer = await WorkbookCacheService.beginSession(prefix);
    let parsedSheets: ParsedSheetMeta[] = [];
    try {
      const taken = new Set<string>();
      for (const upload of uploads) {
        const sheets = await parseUploadIntoCache(
          upload,
          writer,
          taken,
          parsedSheets.length,
          reportRowsFlushed
        );
        parsedSheets = parsedSheets.concat(sheets);
      }
      await writer.finalize("ready");
      onProgress?.(90);
    } catch (err) {
      await writer.fail(err instanceof Error ? err.message : "parse failed");
      void WorkbookCacheService.deleteSession(prefix).catch(() => {});
      throw err;
    }

    await DbService.repository.fileUploads.updateStatusMany(
      uploads.map((u) => u.id),
      "parsed",
      { uploadSessionId }
    );

    const inlineCellsMax = environment.FILE_UPLOAD_INLINE_CELLS_MAX;
    const meta = await WorkbookCacheService.getSessionMeta(prefix);
    if (!meta) {
      throw new ApiError(
        500,
        ApiCode.FILE_UPLOAD_PARSE_FAILED,
        "Session meta missing after finalize"
      );
    }
    let sliced = false;
    const sheets: PreviewSheet[] = [];
    for (const sheetMeta of meta.sheets) {
      const inflated = await inflateSheetPreviewFromChunks(
        prefix,
        sheetMeta,
        inlineCellsMax
      );
      if (inflated.sliced) sliced = true;
      sheets.push(inflated.sheet);
    }

    logger.info(
      {
        organizationId,
        uploadSessionId,
        fileCount: uploads.length,
        sheetCount: meta.sheets.length,
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
    const prefix = uploadSessionCachePrefix(query.uploadSessionId);
    const meta = await this.requireSessionMeta(prefix, organizationId);

    const sheetMeta = findSheetMetaById(meta, query.sheetId);
    if (!sheetMeta) {
      throw new ApiError(
        404,
        ApiCode.FILE_UPLOAD_SLICE_OUT_OF_BOUNDS,
        `Sheet ${query.sheetId} not present in session ${query.uploadSessionId}`
      );
    }
    return sliceSheetRectangleFromChunks(prefix, sheetMeta, query);
  },

  // ── Shared: resolve workbook for interpret/commit ──────────────────

  /**
   * Build a lazy `Workbook` over the chunked cache for the layout-plan
   * pipeline (interpret + commit). On cache miss the caller's session
   * is gone — we re-parse from S3 by re-driving the chunked path, then
   * return a fresh lazy adapter against the new prefix.
   *
   * Memory cost on the read path is bounded by the chunk size the
   * caller's `loadRange` requests — typically a region's bounds — so
   * even 100MB+ workbooks no longer materialise in V8 heap during
   * commit. See `docs/SPREADSHEET_PARSER_ROW_ASYNC.spec.md`.
   */
  async resolveWorkbook(
    uploadSessionId: string,
    organizationId: string
  ): Promise<Workbook> {
    const prefix = uploadSessionCachePrefix(uploadSessionId);
    let meta = await WorkbookCacheService.getSessionMeta(prefix);

    if (!meta || meta.status !== "ready") {
      // Cache miss / expired — re-stream from S3 using the file_uploads rows
      // keyed to this session.
      const uploadsForSession =
        await DbService.repository.fileUploads.findByUploadSessionId(
          uploadSessionId
        );
      if (uploadsForSession.length === 0) {
        throw new ApiError(
          404,
          ApiCode.FILE_UPLOAD_SESSION_NOT_FOUND,
          `Upload session ${uploadSessionId} not found`
        );
      }
      for (const upload of uploadsForSession) {
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

      const writer = await WorkbookCacheService.beginSession(prefix);
      try {
        const taken = new Set<string>();
        let offset = 0;
        for (const upload of uploadsForSession) {
          const out = await parseUploadIntoCache(upload, writer, taken, offset);
          offset += out.length;
        }
        await writer.finalize("ready");
      } catch (err) {
        await writer.fail(
          err instanceof Error ? err.message : "re-parse failed"
        );
        throw err;
      }
      meta = await WorkbookCacheService.getSessionMeta(prefix);
      if (!meta) {
        throw new ApiError(
          500,
          ApiCode.FILE_UPLOAD_PARSE_FAILED,
          "Session meta missing after re-parse"
        );
      }
    } else {
      // Hot path — verify session ownership against the DB rows. Without
      // this an unauthenticated org could probe sessions by id.
      const uploadsForSession =
        await DbService.repository.fileUploads.findByUploadSessionId(
          uploadSessionId
        );
      for (const upload of uploadsForSession) {
        if (upload.organizationId !== organizationId) {
          throw new ApiError(
            403,
            ApiCode.FILE_UPLOAD_FORBIDDEN,
            "Upload session belongs to a different organization"
          );
        }
      }
    }

    return makeLazyWorkbookFromCache(prefix, meta.sheets);
  },

  /**
   * Internal helper: load session meta and verify ownership against the
   * DB rows tied to the session. Throws 404 / 403 instead of returning.
   */
  async requireSessionMeta(prefix: string, organizationId: string) {
    const meta = await WorkbookCacheService.getSessionMeta(prefix);
    if (!meta || meta.status !== "ready") {
      throw new ApiError(
        404,
        ApiCode.FILE_UPLOAD_SESSION_NOT_FOUND,
        `Upload session not ready or expired`
      );
    }
    // Map prefix back to sessionId; prefix format is `upload-session:<id>`.
    const uploadSessionId = prefix.replace(/^upload-session:/, "");
    const uploadsForSession =
      await DbService.repository.fileUploads.findByUploadSessionId(
        uploadSessionId
      );
    for (const upload of uploadsForSession) {
      if (upload.organizationId !== organizationId) {
        throw new ApiError(
          403,
          ApiCode.FILE_UPLOAD_FORBIDDEN,
          "Upload session belongs to a different organization"
        );
      }
    }
    return meta;
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
   * Mark a session's rows committed and best-effort delete the S3 objects
   * plus the chunked cache. Called by the commit pipeline on success.
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
    await WorkbookCacheService.deleteSession(
      uploadSessionCachePrefix(uploadSessionId)
    );
    // Fire-and-forget S3 deletes; residual objects are also swept by the
    // bucket lifecycle rule.
    for (const upload of uploads) {
      S3Service.deleteObject(upload.s3Key).catch((err) => {
        logger.warn(
          {
            s3Key: upload.s3Key,
            err: err instanceof Error ? err.message : err,
          },
          "Failed to delete S3 object on commit"
        );
      });
    }
  },
};
