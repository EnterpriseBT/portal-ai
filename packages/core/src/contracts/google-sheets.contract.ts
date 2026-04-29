import { z } from "zod";

import {
  FileUploadParseSheetSchema,
  FileUploadSheetSliceResponsePayloadSchema,
} from "./file-uploads.contract.js";

/**
 * Google Sheets connector — endpoint contracts.
 *
 * The select-sheet response is structurally the same as the file-upload
 * `parseSession` response (sheets + optional sliced flag), and the
 * sheet-slice response is byte-identical. Aliased rather than redefined
 * so RegionEditor consumes the same shape regardless of source.
 *
 * See `docs/GOOGLE_SHEETS_CONNECTOR.phase-{B,C}.plan.md`.
 */

// ── POST /api/connectors/google-sheets/authorize ─────────────────────

export const GoogleSheetsAuthorizeResponsePayloadSchema = z.object({
  url: z.string().url(),
});
export type GoogleSheetsAuthorizeResponsePayload = z.infer<
  typeof GoogleSheetsAuthorizeResponsePayloadSchema
>;

// ── GET /api/connectors/google-sheets/sheets ─────────────────────────

export const GoogleSheetsListSheetsRequestQuerySchema = z.object({
  connectorInstanceId: z.string().min(1),
  search: z.string().optional(),
  pageToken: z.string().optional(),
});
export type GoogleSheetsListSheetsRequestQuery = z.infer<
  typeof GoogleSheetsListSheetsRequestQuerySchema
>;

export const GoogleSheetsListSheetsItemSchema = z.object({
  spreadsheetId: z.string().min(1),
  name: z.string().min(1),
  modifiedTime: z.string(),
  ownerEmail: z.string().nullable(),
});
export type GoogleSheetsListSheetsItem = z.infer<
  typeof GoogleSheetsListSheetsItemSchema
>;

export const GoogleSheetsListSheetsResponsePayloadSchema = z.object({
  items: z.array(GoogleSheetsListSheetsItemSchema),
  nextPageToken: z.string().optional(),
});
export type GoogleSheetsListSheetsResponsePayload = z.infer<
  typeof GoogleSheetsListSheetsResponsePayloadSchema
>;

// ── POST /api/connectors/google-sheets/instances/:id/select-sheet ─────

export const GoogleSheetsSelectSheetRequestBodySchema = z.object({
  spreadsheetId: z.string().min(1),
});
export type GoogleSheetsSelectSheetRequestBody = z.infer<
  typeof GoogleSheetsSelectSheetRequestBodySchema
>;

/** SDK-side input bundles the path id with the body. */
export const GoogleSheetsSelectSheetRequestSchema = z.object({
  connectorInstanceId: z.string().min(1),
  spreadsheetId: z.string().min(1),
});
export type GoogleSheetsSelectSheetRequest = z.infer<
  typeof GoogleSheetsSelectSheetRequestSchema
>;

export const GoogleSheetsSelectSheetResponsePayloadSchema = z.object({
  sheets: z.array(FileUploadParseSheetSchema),
  sliced: z.boolean().optional(),
});
export type GoogleSheetsSelectSheetResponsePayload = z.infer<
  typeof GoogleSheetsSelectSheetResponsePayloadSchema
>;

// ── GET /api/connectors/google-sheets/instances/:id/sheet-slice ───────

/**
 * SDK-side input — `connectorInstanceId` lives in the URL path on the
 * API; the SDK's URL builder reads it off the variables and the rest
 * become query-string params.
 */
export const GoogleSheetsSheetSliceRequestSchema = z.object({
  connectorInstanceId: z.string().min(1),
  sheetId: z.string().min(1),
  rowStart: z.coerce.number().int().min(0),
  rowEnd: z.coerce.number().int().min(0),
  colStart: z.coerce.number().int().min(0),
  colEnd: z.coerce.number().int().min(0),
});
export type GoogleSheetsSheetSliceRequest = z.infer<
  typeof GoogleSheetsSheetSliceRequestSchema
>;

export const GoogleSheetsSheetSliceResponsePayloadSchema =
  FileUploadSheetSliceResponsePayloadSchema;
export type GoogleSheetsSheetSliceResponsePayload = z.infer<
  typeof GoogleSheetsSheetSliceResponsePayloadSchema
>;
