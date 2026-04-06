import { z } from "zod";
import { CoreModel, CoreSchema, ModelFactory } from "./base.model.js";

/**
 * Tool packs that can be enabled for a station.
 * Each pack gates a group of analytics tools exposed to Claude.
 */
export const StationToolPackSchema = z.enum([
  "data_query",
  "statistics",
  "regression",
  "financial",
  "web_search",
  "entity_management",
]);

export type StationToolPack = z.infer<typeof StationToolPackSchema>;

/**
 * Station model.
 * Represents a curated collection of connector instances that are
 * grouped together for analytics purposes within an organization.
 *
 * Sync with the Drizzle `stations` table is enforced at compile
 * time via `apps/api/src/db/schema/type-checks.ts` and at runtime
 * via drizzle-zod derived schemas in `apps/api/src/db/schema/zod.ts`.
 */
export const StationSchema = CoreSchema.extend({
  organizationId: z.string(),
  name: z.string().min(1),
  description: z.string().nullable(),
  toolPacks: z.array(z.string()).min(1),
});

export type Station = z.infer<typeof StationSchema>;

export class StationModel extends CoreModel<Station> {
  get schema() {
    return StationSchema;
  }

  parse(): Station {
    return this.schema.parse(this._model);
  }

  validate(): z.ZodSafeParseResult<Station> {
    return this.schema.safeParse(this._model);
  }
}

export class StationModelFactory extends ModelFactory<Station, StationModel> {
  create(createdBy: string): StationModel {
    const baseModel = this._coreModelFactory.create(createdBy);
    const stationModel = new StationModel(baseModel.toJSON());
    return stationModel;
  }
}
