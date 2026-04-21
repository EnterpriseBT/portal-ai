import { z } from "zod";

import { WorkbookSchema } from "./spreadsheet-parsing.contract.js";

/**
 * Response payload for `POST /api/file-uploads/parse`.
 *
 * The endpoint accepts a multipart `file` field and returns the adapted
 * `Workbook`. The request body itself is multipart and therefore not a Zod
 * schema — the router enforces multipart shape outside validation.
 */
export const FileUploadParseResponsePayloadSchema = z.object({
  workbook: WorkbookSchema,
});
export type FileUploadParseResponsePayload = z.infer<
  typeof FileUploadParseResponsePayloadSchema
>;
