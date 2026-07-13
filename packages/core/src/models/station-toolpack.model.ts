import { z } from "zod";
import { CoreModel, CoreSchema, ModelFactory } from "./base.model.js";

/**
 * Station Toolpack join model.
 * Represents the assignment of a toolpack — built-in or custom — to a
 * specific station. Exactly one of `builtinSlug` or
 * `organizationToolpackId` is set per row (XOR), enforced both here
 * and by a CHECK constraint on the `station_toolpacks` table.
 *
 * Phase 1 only ever populates `builtinSlug`. The
 * `organizationToolpackId` column exists from phase 1 (nullable,
 * unused) so phase 2's `organization_toolpacks` migration is purely
 * additive.
 *
 * Sync with the Drizzle `station_toolpacks` table is enforced at
 * compile time via `apps/api/src/db/schema/type-checks.ts` and at
 * runtime via drizzle-zod derived schemas in
 * `apps/api/src/db/schema/zod.ts`.
 */
export const StationToolpackSchema = CoreSchema.extend({
  stationId: z.string(),
  builtinSlug: z.string().nullable(),
  organizationToolpackId: z.string().nullable(),
}).refine(
  (v) => (v.builtinSlug === null) !== (v.organizationToolpackId === null),
  {
    message: "Exactly one of builtinSlug or organizationToolpackId must be set",
  }
);

export type StationToolpack = z.infer<typeof StationToolpackSchema>;

export class StationToolpackModel extends CoreModel<StationToolpack> {
  get schema() {
    return StationToolpackSchema;
  }

  parse(): StationToolpack {
    return this.schema.parse(this._model);
  }

  validate(): z.ZodSafeParseResult<StationToolpack> {
    return this.schema.safeParse(this._model);
  }
}

export class StationToolpackModelFactory extends ModelFactory<
  StationToolpack,
  StationToolpackModel
> {
  create(createdBy: string): StationToolpackModel {
    const baseModel = this._coreModelFactory.create(createdBy);
    return new StationToolpackModel(baseModel.toJSON());
  }
}
