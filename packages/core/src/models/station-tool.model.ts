import { z } from "zod";
import { CoreModel, CoreSchema, ModelFactory } from "./base.model.js";

/**
 * Station Tool join model.
 * Represents the assignment of an organization-level tool to a
 * specific station.
 *
 * Sync with the Drizzle `station_tools` table is enforced at compile
 * time via `apps/api/src/db/schema/type-checks.ts` and at runtime
 * via drizzle-zod derived schemas in `apps/api/src/db/schema/zod.ts`.
 */
export const StationToolSchema = CoreSchema.extend({
  stationId: z.string(),
  organizationToolId: z.string(),
});

export type StationTool = z.infer<typeof StationToolSchema>;

export class StationToolModel extends CoreModel<StationTool> {
  get schema() {
    return StationToolSchema;
  }

  parse(): StationTool {
    return this.schema.parse(this._model);
  }

  validate(): z.ZodSafeParseResult<StationTool> {
    return this.schema.safeParse(this._model);
  }
}

export class StationToolModelFactory extends ModelFactory<
  StationTool,
  StationToolModel
> {
  create(createdBy: string): StationToolModel {
    const baseModel = this._coreModelFactory.create(createdBy);
    const stationToolModel = new StationToolModel(baseModel.toJSON());
    return stationToolModel;
  }
}
