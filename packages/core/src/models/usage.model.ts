import { z } from "zod";
import { CoreModel, CoreSchema, ModelFactory } from "./base.model.js";

/**
 * Per-org, per-period usage balance (#172).
 *
 * One row per `(organizationId, periodId, costClass)` holding the units
 * consumed this billing period. #172 owns this durable balance; the cost gate
 * (#169) increments it as part of its atomic charge. `available = allocation −
 * unitsUsed` is computed by `UsageService.getBalance`.
 *
 * `costClass` is a `string` here because the DB column is `text`
 * (CHECK-constrained to the `free | metered | expensive` set); consumers
 * narrow it to `CostHint` when reading. Kept in sync with the Drizzle `usage`
 * table via `apps/api/src/db/schema/type-checks.ts`.
 */
export const UsageSchema = CoreSchema.extend({
  organizationId: z.string(),
  periodId: z.string(), // e.g. "2026-07" — TierService.periodIdFor
  costClass: z.string(), // CHECK-constrained; narrowed to CostHint on read
  unitsUsed: z.number().int().nonnegative(),
});

export type Usage = z.infer<typeof UsageSchema>;

export class UsageModel extends CoreModel<Usage> {
  get schema() {
    return UsageSchema;
  }

  parse(): Usage {
    return this.schema.parse(this._model);
  }

  validate(): z.ZodSafeParseResult<Usage> {
    return this.schema.safeParse(this._model);
  }
}

export class UsageModelFactory extends ModelFactory<Usage, UsageModel> {
  create(createdBy: string): UsageModel {
    const baseModel = this._coreModelFactory.create(createdBy);
    return new UsageModel(baseModel.toJSON());
  }
}
