import { z } from "zod";

/**
 * Microsoft 365 Excel connector — endpoint contracts.
 *
 * Phase A only ships the authorize-response schema. List/select/slice
 * land in Phase B alongside the workbook discovery + download surface.
 */

// ── POST /api/connectors/microsoft-excel/authorize ───────────────────

export const MicrosoftExcelAuthorizeResponsePayloadSchema = z.object({
  url: z.string().url(),
});
export type MicrosoftExcelAuthorizeResponsePayload = z.infer<
  typeof MicrosoftExcelAuthorizeResponsePayloadSchema
>;
