import { NextFunction, Request, Response, Router } from "express";
import multer from "multer";

import type { FileUploadParseResponsePayload } from "@portalai/core/contracts";

import { ApiCode } from "../constants/api-codes.constants.js";
import { environment } from "../environment.js";
import { getApplicationMetadata } from "../middleware/metadata.middleware.js";
import { FileUploadParseService } from "../services/file-upload-parse.service.js";
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
