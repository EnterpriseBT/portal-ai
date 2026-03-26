import { z } from "zod";
import { CoreModel, CoreSchema, ModelFactory } from "./base.model.js";

/**
 * Station Instance join model.
 * Links a station to a connector instance.
 *
 * Sync with the Drizzle `station_instances` table is enforced at
 * compile time via `apps/api/src/db/schema/type-checks.ts` and at
 * runtime via drizzle-zod derived schemas in
 * `apps/api/src/db/schema/zod.ts`.
 */
export const StationInstanceSchema = CoreSchema.extend({
  stationId: z.string(),
  connectorInstanceId: z.string(),
});

export type StationInstance = z.infer<typeof StationInstanceSchema>;

export class StationInstanceModel extends CoreModel<StationInstance> {
  get schema() {
    return StationInstanceSchema;
  }

  parse(): StationInstance {
    return this.schema.parse(this._model);
  }

  validate(): z.ZodSafeParseResult<StationInstance> {
    return this.schema.safeParse(this._model);
  }
}

export class StationInstanceModelFactory extends ModelFactory<
  StationInstance,
  StationInstanceModel
> {
  create(createdBy: string): StationInstanceModel {
    const baseModel = this._coreModelFactory.create(createdBy);
    const stationInstanceModel = new StationInstanceModel(baseModel.toJSON());
    return stationInstanceModel;
  }
}
