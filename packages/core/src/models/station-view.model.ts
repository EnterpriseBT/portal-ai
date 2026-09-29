import { z } from "zod";
import { CoreModel, CoreSchema, ModelFactory } from "./base.model.js";

/**
 * Station View attachment (#599).
 *
 * Attaches a curated view to a station — the sole data attachment,
 * replacing the connector-instance attachment (`station_instances`). A
 * station's session surfaces the views attached here that the caller can
 * read.
 *
 * Sync with the Drizzle `station_views` table is enforced at compile time
 * via `apps/api/src/db/schema/type-checks.ts` and at runtime via
 * drizzle-zod derived schemas in `apps/api/src/db/schema/zod.ts`.
 */
export const StationViewSchema = CoreSchema.extend({
  organizationId: z.string(),
  stationId: z.string(),
  curatedViewId: z.string(),
});

export type StationView = z.infer<typeof StationViewSchema>;

export class StationViewModel extends CoreModel<StationView> {
  get schema() {
    return StationViewSchema;
  }

  parse(): StationView {
    return this.schema.parse(this._model);
  }

  validate(): z.ZodSafeParseResult<StationView> {
    return this.schema.safeParse(this._model);
  }
}

export class StationViewModelFactory extends ModelFactory<
  StationView,
  StationViewModel
> {
  create(createdBy: string): StationViewModel {
    const baseModel = this._coreModelFactory.create(createdBy);
    const model = new StationViewModel(baseModel.toJSON());
    return model;
  }
}
