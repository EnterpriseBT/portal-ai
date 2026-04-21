import { NextFunction, Request, Response, Router } from "express";
import multer from "multer";

import {
  FileUploadConfirmRequestBodySchema,
  FileUploadParseSessionRequestBodySchema,
  FileUploadPresignRequestBodySchema,
  FileUploadSheetSliceRequestQuerySchema,
} from "@portalai/core/contracts";
import type {
  FileUploadConfirmResponsePayload,
  FileUploadParseResponsePayload,
  FileUploadParseSessionResponsePayload,
  FileUploadPresignResponsePayload,
  FileUploadSheetSliceResponsePayload,
} from "@portalai/core/contracts";

import { ApiCode } from "../constants/api-codes.constants.js";
import { environment } from "../environment.js";
import { getApplicationMetadata } from "../middleware/metadata.middleware.js";
import { FileUploadParseService } from "../services/file-upload-parse.service.js";
import { FileUploadSessionService } from "../services/file-upload-session.service.js";
import { ApiError, HttpService } from "../services/http.service.js";
import { createLogger } from "../utils/logger.util.js";

const logger = createLogger({ module: "file-uploads" });

export const fileUploadsRouter = Router();

const MAX_FILES = 25;

function handleMulter(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  const upload = multer({
    storage: multer.memoryStorage(),
    limits: {
      fileSize: environment.FILE_UPLOAD_PARSE_MAX_BYTES,
      files: MAX_FILES,
    },
  });
  const run = upload.array("file", MAX_FILES);
  run(req, res, (err: unknown) => {
    if (err instanceof multer.MulterError) {
      if (err.code === "LIMIT_FILE_SIZE") {
        return next(
          new ApiError(
            413,
            ApiCode.FILE_UPLOAD_PARSE_TOO_LARGE,
            `File exceeds maximum size of ${environment.FILE_UPLOAD_PARSE_MAX_BYTES} bytes`
          )
        );
      }
      return next(
        new ApiError(
          400,
          ApiCode.FILE_UPLOAD_PARSE_INVALID_PAYLOAD,
          err.message
        )
      );
    }
    if (err) {
      return next(err instanceof Error ? err : new Error(String(err)));
    }
    next();
  });
}

/**
 * @openapi
 * /api/file-uploads/parse:
 *   post:
 *     tags:
 *       - File Uploads
 *     summary: Parse one or more uploaded spreadsheets into a single canonical Workbook
 *     description: |
 *       Accepts one or more CSV/TSV/XLSX/XLS files via multipart form-data
 *       under the repeating `file` field and returns the adapted `Workbook` —
 *       the same shape the `interpret` endpoint consumes. Sheets from each
 *       file are merged in upload order; duplicate sheet names are
 *       disambiguated with a numeric suffix (`Sheet1`, `Sheet1 (2)`, …).
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         multipart/form-data:
 *           schema:
 *             type: object
 *             required:
 *               - file
 *             properties:
 *               file:
 *                 type: array
 *                 items:
 *                   type: string
 *                   format: binary
 *     responses:
 *       200:
 *         description: Parsed workbook
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 payload:
 *                   $ref: '#/components/schemas/FileUploadParseResponsePayload'
 *       400:
 *         description: Invalid payload, empty file, or unsupported extension
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ApiErrorResponse'
 *       413:
 *         description: File exceeds FILE_UPLOAD_PARSE_MAX_BYTES
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ApiErrorResponse'
 *       500:
 *         description: Adapter failed to parse
 */
// ── Streaming pipeline ────────────────────────────────────────────────
// (docs/LARGE_WORKBOOK_STREAMING.plan.md §Phase 1–3b)

/**
 * @openapi
 * /api/file-uploads/presign:
 *   post:
 *     tags: [File Uploads]
 *     summary: Mint presigned PUT URLs for direct-to-S3 upload
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [files]
 *             properties:
 *               files:
 *                 type: array
 *                 items:
 *                   type: object
 *                   required: [fileName, contentType, sizeBytes]
 *                   properties:
 *                     fileName:
 *                       type: string
 *                     contentType:
 *                       type: string
 *                     sizeBytes:
 *                       type: integer
 *     responses:
 *       200:
 *         description: Presigned URLs issued
 *       400:
 *         description: Invalid body, unsupported extension, or too many files
 *       413:
 *         description: File size exceeds configured cap
 */
fileUploadsRouter.post(
  "/presign",
  getApplicationMetadata,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const organizationId = req.application?.metadata.organizationId as string;
      const userId = req.application?.metadata.userId as string;
      const parsed = FileUploadPresignRequestBodySchema.safeParse(req.body);
      if (!parsed.success) {
        return next(
          new ApiError(
            400,
            ApiCode.FILE_UPLOAD_PARSE_INVALID_PAYLOAD,
            "Invalid presign body",
            { issues: parsed.error.issues }
          )
        );
      }
      const payload = await FileUploadSessionService.presign(
        organizationId,
        userId,
        parsed.data.files
      );
      return HttpService.success<FileUploadPresignResponsePayload>(res, payload);
    } catch (err) {
      return next(
        err instanceof ApiError
          ? err
          : new ApiError(
              500,
              ApiCode.FILE_UPLOAD_PARSE_FAILED,
              err instanceof Error ? err.message : "Presign failed"
            )
      );
    }
  }
);

/**
 * @openapi
 * /api/file-uploads/confirm:
 *   post:
 *     tags: [File Uploads]
 *     summary: Confirm that the browser's PUT to the presigned URL succeeded
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [uploadId]
 *             properties:
 *               uploadId:
 *                 type: string
 *     responses:
 *       200:
 *         description: Upload confirmed
 *       404:
 *         description: Upload row not found
 *       403:
 *         description: Upload belongs to another organization
 *       409:
 *         description: Upload not in state "pending" or S3 object missing
 */
fileUploadsRouter.post(
  "/confirm",
  getApplicationMetadata,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const organizationId = req.application?.metadata.organizationId as string;
      const parsed = FileUploadConfirmRequestBodySchema.safeParse(req.body);
      if (!parsed.success) {
        return next(
          new ApiError(
            400,
            ApiCode.FILE_UPLOAD_PARSE_INVALID_PAYLOAD,
            "Invalid confirm body",
            { issues: parsed.error.issues }
          )
        );
      }
      const payload = await FileUploadSessionService.confirm(
        organizationId,
        parsed.data.uploadId
      );
      return HttpService.success<FileUploadConfirmResponsePayload>(res, payload);
    } catch (err) {
      return next(
        err instanceof ApiError
          ? err
          : new ApiError(
              500,
              ApiCode.FILE_UPLOAD_PARSE_FAILED,
              err instanceof Error ? err.message : "Confirm failed"
            )
      );
    }
  }
);

/**
 * @openapi
 * /api/file-uploads/parse-session:
 *   post:
 *     tags: [File Uploads]
 *     summary: Stream uploads from S3, parse, cache workbook, return preview
 *     description: |
 *       Accepts one or more `uploadIds` from prior presign+confirm calls,
 *       streams each from S3, merges the sheets, caches the parsed workbook
 *       in Redis (TTL `FILE_UPLOAD_CACHE_TTL_SEC`), and returns the workbook
 *       inline. Sheets whose cell count exceeds `FILE_UPLOAD_INLINE_CELLS_MAX`
 *       come back with `cells: []` and the top-level `sliced: true` flag set
 *       — clients fetch those sheets via `/api/file-uploads/sheet-slice`.
 *     security:
 *       - bearerAuth: []
 */
fileUploadsRouter.post(
  "/parse-session",
  getApplicationMetadata,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const organizationId = req.application?.metadata.organizationId as string;
      const parsed = FileUploadParseSessionRequestBodySchema.safeParse(req.body);
      if (!parsed.success) {
        return next(
          new ApiError(
            400,
            ApiCode.FILE_UPLOAD_PARSE_INVALID_PAYLOAD,
            "Invalid parse-session body",
            { issues: parsed.error.issues }
          )
        );
      }
      const payload = await FileUploadSessionService.parseSession(
        organizationId,
        parsed.data.uploadIds
      );
      return HttpService.success<FileUploadParseSessionResponsePayload>(
        res,
        payload
      );
    } catch (err) {
      return next(
        err instanceof ApiError
          ? err
          : new ApiError(
              500,
              ApiCode.FILE_UPLOAD_PARSE_FAILED,
              err instanceof Error ? err.message : "Parse session failed"
            )
      );
    }
  }
);

/**
 * @openapi
 * /api/file-uploads/sheet-slice:
 *   get:
 *     tags: [File Uploads]
 *     summary: Fetch a cell rectangle from a parsed workbook
 *     description: |
 *       Serves slices for sheets that came back with `sliced: true` from
 *       `/parse-session`. Coordinates clamp to the sheet's dimensions; the
 *       rectangle's cell count must be ≤ `FILE_UPLOAD_SLICE_CELLS_MAX`.
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: uploadSessionId
 *         required: true
 *         schema: { type: string }
 *       - in: query
 *         name: sheetId
 *         required: true
 *         schema: { type: string }
 *       - in: query
 *         name: rowStart
 *         required: true
 *         schema: { type: integer, minimum: 0 }
 *       - in: query
 *         name: rowEnd
 *         required: true
 *         schema: { type: integer, minimum: 0 }
 *       - in: query
 *         name: colStart
 *         required: true
 *         schema: { type: integer, minimum: 0 }
 *       - in: query
 *         name: colEnd
 *         required: true
 *         schema: { type: integer, minimum: 0 }
 */
fileUploadsRouter.get(
  "/sheet-slice",
  getApplicationMetadata,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const organizationId = req.application?.metadata.organizationId as string;
      const parsed = FileUploadSheetSliceRequestQuerySchema.safeParse(req.query);
      if (!parsed.success) {
        return next(
          new ApiError(
            400,
            ApiCode.FILE_UPLOAD_PARSE_INVALID_PAYLOAD,
            "Invalid sheet-slice query",
            { issues: parsed.error.issues }
          )
        );
      }
      const payload = await FileUploadSessionService.sheetSlice(
        organizationId,
        parsed.data
      );
      return HttpService.success<FileUploadSheetSliceResponsePayload>(
        res,
        payload
      );
    } catch (err) {
      return next(
        err instanceof ApiError
          ? err
          : new ApiError(
              500,
              ApiCode.FILE_UPLOAD_PARSE_FAILED,
              err instanceof Error ? err.message : "Slice failed"
            )
      );
    }
  }
);

// ── Legacy multipart parse (kept until PR 5 cutover) ──────────────────

fileUploadsRouter.post(
  "/parse",
  getApplicationMetadata,
  handleMulter,
  async (req: Request, res: Response, next: NextFunction) => {
    const started = Date.now();
    try {
      const files = (req.files ?? []) as Express.Multer.File[];
      if (files.length === 0) {
        return next(
          new ApiError(
            400,
            ApiCode.FILE_UPLOAD_PARSE_INVALID_PAYLOAD,
            "Missing `file` field in multipart payload"
          )
        );
      }

      const { workbook } = await FileUploadParseService.parse(
        files.map((f) => ({ buffer: f.buffer, filename: f.originalname }))
      );

      logger.info(
        {
          fileCount: files.length,
          totalBytes: files.reduce((acc, f) => acc + f.size, 0),
          sheetCount: workbook.sheets.length,
          durationMs: Date.now() - started,
        },
        "file-upload parse completed"
      );

      return HttpService.success<FileUploadParseResponsePayload>(res, {
        workbook,
      });
    } catch (error) {
      if (!(error instanceof ApiError)) {
        logger.error(
          { error: error instanceof Error ? error.message : "Unknown error" },
          "file-upload parse failed"
        );
      }
      return next(
        error instanceof ApiError
          ? error
          : new ApiError(
              500,
              ApiCode.FILE_UPLOAD_PARSE_FAILED,
              "Failed to parse file"
            )
      );
    }
  }
);
