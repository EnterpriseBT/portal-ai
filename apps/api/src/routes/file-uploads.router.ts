import { NextFunction, Request, Response, Router } from "express";

import {
  FileUploadConfirmRequestBodySchema,
  FileUploadParseSessionRequestBodySchema,
  FileUploadPresignRequestBodySchema,
  FileUploadSheetSliceRequestQuerySchema,
} from "@portalai/core/contracts";
import type {
  FileUploadConfirmResponsePayload,
  FileUploadParseSessionResponsePayload,
  FileUploadPresignResponsePayload,
  FileUploadSheetSliceResponsePayload,
} from "@portalai/core/contracts";

import { ApiCode } from "../constants/api-codes.constants.js";
import { getApplicationMetadata } from "../middleware/metadata.middleware.js";
import { FileUploadSessionService } from "../services/file-upload-session.service.js";
import { ApiError, HttpService } from "../services/http.service.js";

export const fileUploadsRouter = Router();

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
 * /api/file-uploads/parse:
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
  "/parse",
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

