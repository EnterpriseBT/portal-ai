import { z } from "zod";
import { PaginationRequestQuerySchema } from "./pagination.contract.js";
import { ToolUsageLedgerEntrySchema } from "../models/tool-usage-ledger.model.js";

/**
 * Usage-ledger endpoint contracts (#179) — the itemized, paginated read
 * behind the aggregate usage display (`GET /api/organization/usage/ledger`).
 */

/** Query for the ledger list: house pagination + optional filters.
 *  `sortOrder` defaults to `desc` (newest-first — the audit-trail read). */
export const UsageLedgerListRequestQuerySchema =
  PaginationRequestQuerySchema.extend({
    periodId: z.string().optional(),
    toolName: z.string().optional(),
    sortOrder: z.enum(["asc", "desc"]).optional().default("desc"),
  });
export type UsageLedgerListRequestQuery = z.infer<
  typeof UsageLedgerListRequestQuerySchema
>;

/** One page of ledger entries + the filter-scoped total. */
export const UsageLedgerListResponseSchema = z.object({
  entries: z.array(ToolUsageLedgerEntrySchema),
  total: z.number().int(),
});
export type UsageLedgerListResponse = z.infer<
  typeof UsageLedgerListResponseSchema
>;
