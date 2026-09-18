import { z } from "zod";
import { PaginationRequestQuerySchema } from "./pagination.contract.js";
import {
  AuditActionSchema,
  AuditOutcomeSchema,
  AuditLogEntrySchema,
} from "../models/audit-log.model.js";

/**
 * Audit-log endpoint contracts (#575) — the org-scoped, owner-gated paginated
 * read behind `GET /api/organization/audit-log`.
 */

/** Query for the audit-log list: house pagination + optional filters.
 *  `sortOrder` defaults to `desc` (newest-first — the audit-trail read). */
export const AuditLogListRequestQuerySchema =
  PaginationRequestQuerySchema.extend({
    action: AuditActionSchema.optional(),
    outcome: AuditOutcomeSchema.optional(),
    sortOrder: z.enum(["asc", "desc"]).optional().default("desc"),
  });
export type AuditLogListRequestQuery = z.infer<
  typeof AuditLogListRequestQuerySchema
>;

/** One page of audit-log entries + the filter-scoped total. */
export const AuditLogListResponseSchema = z.object({
  entries: z.array(AuditLogEntrySchema),
  total: z.number().int(),
});
export type AuditLogListResponse = z.infer<typeof AuditLogListResponseSchema>;
