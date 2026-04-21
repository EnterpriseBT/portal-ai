import { z } from "zod";

// Frontend-facing cell value — the dense 2-D grid the region editor renders
// from. Booleans / dates are coerced to strings by the backend adapter so the
// preview is JSON-safe without a custom reviver.
const PreviewCellValueSchema = z
  .union([z.string(), z.number(), z.null()])
  .describe("Preview cell value — string | number | null");

const SheetDimensionsSchema = z.object({
  rows: z.number().int().min(0),
  cols: z.number().int().min(0),
});

// ── Phase 1: POST /api/file-uploads/presign ──────────────────────────────

/**
 * One file the client intends to upload. `sizeBytes` is advisory — the
 * server enforces its own ceiling via `UPLOAD_MAX_FILE_SIZE_BYTES`.
 */
export const FileUploadPresignFileSchema = z.object({
  fileName: z.string().min(1),
  contentType: z.string().min(1),
  sizeBytes: z.number().int().nonnegative(),
});
export type FileUploadPresignFile = z.infer<typeof FileUploadPresignFileSchema>;

export const FileUploadPresignRequestBodySchema = z.object({
  files: z.array(FileUploadPresignFileSchema).min(1),
});
export type FileUploadPresignRequestBody = z.infer<
  typeof FileUploadPresignRequestBodySchema
>;

export const FileUploadPresignItemSchema = z.object({
  uploadId: z.string().min(1),
  s3Key: z.string().min(1),
  putUrl: z.string().url(),
  expiresAt: z.number().int().positive(),
});
export type FileUploadPresignItem = z.infer<typeof FileUploadPresignItemSchema>;

export const FileUploadPresignResponsePayloadSchema = z.object({
  uploads: z.array(FileUploadPresignItemSchema),
});
export type FileUploadPresignResponsePayload = z.infer<
  typeof FileUploadPresignResponsePayloadSchema
>;

// ── Phase 2: POST /api/file-uploads/confirm ──────────────────────────────

export const FileUploadConfirmRequestBodySchema = z.object({
  uploadId: z.string().min(1),
});
export type FileUploadConfirmRequestBody = z.infer<
  typeof FileUploadConfirmRequestBodySchema
>;

export const FileUploadConfirmResponsePayloadSchema = z.object({
  uploadId: z.string().min(1),
  status: z.literal("uploaded"),
  sizeBytes: z.number().int().nonnegative(),
});
export type FileUploadConfirmResponsePayload = z.infer<
  typeof FileUploadConfirmResponsePayloadSchema
>;

// ── Phase 3: POST /api/file-uploads/parse (streaming body) ───────────────

export const FileUploadParseSessionRequestBodySchema = z.object({
  uploadIds: z.array(z.string().min(1)).min(1),
});
export type FileUploadParseSessionRequestBody = z.infer<
  typeof FileUploadParseSessionRequestBodySchema
>;

/**
 * Per-sheet response entry. `cells` is populated for inline-sized sheets;
 * sheets over `FILE_UPLOAD_INLINE_CELLS_MAX` return with `cells: []` and
 * the top-level `sliced: true` flag set, pulling cells from
 * `GET /api/file-uploads/sheet-slice` instead.
 */
export const FileUploadParseSheetSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  dimensions: SheetDimensionsSchema,
  cells: z.array(z.array(PreviewCellValueSchema)),
});
export type FileUploadParseSheet = z.infer<typeof FileUploadParseSheetSchema>;

export const FileUploadParseSessionResponsePayloadSchema = z.object({
  uploadSessionId: z.string().min(1),
  sheets: z.array(FileUploadParseSheetSchema),
  sliced: z.boolean().optional(),
});
export type FileUploadParseSessionResponsePayload = z.infer<
  typeof FileUploadParseSessionResponsePayloadSchema
>;

// ── Phase 3b: GET /api/file-uploads/sheet-slice ──────────────────────────

export const FileUploadSheetSliceRequestQuerySchema = z.object({
  uploadSessionId: z.string().min(1),
  sheetId: z.string().min(1),
  rowStart: z.coerce.number().int().min(0),
  rowEnd: z.coerce.number().int().min(0),
  colStart: z.coerce.number().int().min(0),
  colEnd: z.coerce.number().int().min(0),
});
export type FileUploadSheetSliceRequestQuery = z.infer<
  typeof FileUploadSheetSliceRequestQuerySchema
>;

export const FileUploadSheetSliceResponsePayloadSchema = z.object({
  cells: z.array(z.array(PreviewCellValueSchema)),
  rowStart: z.number().int().min(0),
  colStart: z.number().int().min(0),
});
export type FileUploadSheetSliceResponsePayload = z.infer<
  typeof FileUploadSheetSliceResponsePayloadSchema
>;
