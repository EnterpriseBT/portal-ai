import { z } from "zod";
import { CoreModel, CoreSchema, ModelFactory } from "./base.model.js";

/**
 * Tool usage audit ledger entry (#179) — one row per **committed** tool-call
 * charge: the itemized trail behind the aggregate `usage` balance (#172).
 *
 * Append-only with no reversal/credit rows: #183 bills on successful
 * completion and never refunds, so every row is a charge that actually
 * landed. The row is written inside the same transaction as the aggregate
 * increment, so the ledger provably sums to the billed balance.
 *
 * Sync with the Drizzle `tool_usage_ledger` table is enforced at compile
 * time via `apps/api/src/db/schema/type-checks.ts`.
 */
export const ToolUsageLedgerEntrySchema = CoreSchema.extend({
  organizationId: z.string(),
  toolName: z.string(),
  /** Stable per-call id — the AI SDK's toolCallId, `job:<jobId>` for
   *  job-deferred charges, or a synthesized UUID. The dedup key. */
  toolCallId: z.string(),
  stationId: z.string(),
  /** Null for charges whose producer has no portal (job-deferred calls
   *  enqueued outside a portal session). */
  portalId: z.string().nullable(),
  /** Only charged classes appear — `free` never commits a charge. */
  costClass: z.enum(["metered", "expensive"]),
  units: z.number().int().positive(),
  /** The billing period the charge landed in — same `periodIdFor` value
   *  the aggregate increment used (#172/#176 org-anchored). */
  periodId: z.string(),
  /** Who ran the call (dispute resolution: "who did this"). */
  userId: z.string(),
});

export type ToolUsageLedgerEntry = z.infer<typeof ToolUsageLedgerEntrySchema>;

export class ToolUsageLedgerEntryModel extends CoreModel<ToolUsageLedgerEntry> {
  get schema() {
    return ToolUsageLedgerEntrySchema;
  }

  parse(): ToolUsageLedgerEntry {
    return this.schema.parse(this._model);
  }

  validate(): z.ZodSafeParseResult<ToolUsageLedgerEntry> {
    return this.schema.safeParse(this._model);
  }
}

export class ToolUsageLedgerEntryModelFactory extends ModelFactory<
  ToolUsageLedgerEntry,
  ToolUsageLedgerEntryModel
> {
  create(createdBy: string): ToolUsageLedgerEntryModel {
    const baseModel = this._coreModelFactory.create(createdBy);
    return new ToolUsageLedgerEntryModel(baseModel.toJSON());
  }
}
