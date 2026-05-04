import { z } from "zod";

import {
  FileUploadParseSheetSchema,
  FileUploadSheetSliceResponsePayloadSchema,
} from "./file-uploads.contract.js";

/**
 * Microsoft 365 Excel connector — endpoint contracts.
 *
 * The select-workbook response is structurally the same as the
 * file-upload `parseSession` response (sheets + optional sliced flag),
 * and the sheet-slice response is byte-identical. Aliased rather than
 * redefined so RegionEditor consumes the same shape regardless of
 * source.
 */

// ── POST /api/connectors/microsoft-excel/authorize ───────────────────

export const MicrosoftExcelAuthorizeResponsePayloadSchema = z.object({
  url: z.string().url(),
});
export type MicrosoftExcelAuthorizeResponsePayload = z.infer<
  typeof MicrosoftExcelAuthorizeResponsePayloadSchema
>;

// ── GET /api/connectors/microsoft-excel/workbooks ────────────────────

export const MicrosoftExcelListWorkbooksRequestQuerySchema = z.object({
  connectorInstanceId: z.string().min(1),
  search: z.string().optional(),
});
export type MicrosoftExcelListWorkbooksRequestQuery = z.infer<
  typeof MicrosoftExcelListWorkbooksRequestQuerySchema
>;

export const MicrosoftExcelListWorkbooksItemSchema = z.object({
  driveItemId: z.string().min(1),
  name: z.string().min(1),
  lastModifiedDateTime: z.string(),
  lastModifiedBy: z.string().nullable(),
});
export type MicrosoftExcelListWorkbooksItem = z.infer<
  typeof MicrosoftExcelListWorkbooksItemSchema
>;

export const MicrosoftExcelListWorkbooksResponsePayloadSchema = z.object({
  items: z.array(MicrosoftExcelListWorkbooksItemSchema),
});
export type MicrosoftExcelListWorkbooksResponsePayload = z.infer<
  typeof MicrosoftExcelListWorkbooksResponsePayloadSchema
>;

// ── POST /api/connectors/microsoft-excel/instances/:id/select-workbook

export const MicrosoftExcelSelectWorkbookRequestBodySchema = z.object({
  driveItemId: z.string().min(1),
});
export type MicrosoftExcelSelectWorkbookRequestBody = z.infer<
  typeof MicrosoftExcelSelectWorkbookRequestBodySchema
>;

/** SDK-side input bundles the path id with the body. */
export const MicrosoftExcelSelectWorkbookRequestSchema = z.object({
  connectorInstanceId: z.string().min(1),
  driveItemId: z.string().min(1),
});
export type MicrosoftExcelSelectWorkbookRequest = z.infer<
  typeof MicrosoftExcelSelectWorkbookRequestSchema
>;

export const MicrosoftExcelSelectWorkbookResponsePayloadSchema = z.object({
  /** Workbook title — typically the drive item name with the `.xlsx`
   *  extension stripped, used as the connector-instance display name on
   *  commit. */
  title: z.string(),
  sheets: z.array(FileUploadParseSheetSchema),
  sliced: z.boolean().optional(),
});
export type MicrosoftExcelSelectWorkbookResponsePayload = z.infer<
  typeof MicrosoftExcelSelectWorkbookResponsePayloadSchema
>;

// ── GET /api/connectors/microsoft-excel/instances/:id/sheet-slice ────

export const MicrosoftExcelSheetSliceRequestSchema = z.object({
  connectorInstanceId: z.string().min(1),
  sheetId: z.string().min(1),
  rowStart: z.coerce.number().int().min(0),
  rowEnd: z.coerce.number().int().min(0),
  colStart: z.coerce.number().int().min(0),
  colEnd: z.coerce.number().int().min(0),
});
export type MicrosoftExcelSheetSliceRequest = z.infer<
  typeof MicrosoftExcelSheetSliceRequestSchema
>;

export const MicrosoftExcelSheetSliceResponsePayloadSchema =
  FileUploadSheetSliceResponsePayloadSchema;
export type MicrosoftExcelSheetSliceResponsePayload = z.infer<
  typeof MicrosoftExcelSheetSliceResponsePayloadSchema
>;
