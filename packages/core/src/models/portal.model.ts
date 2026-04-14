import { z } from "zod";
import { CoreModel, CoreSchema, ModelFactory } from "./base.model.js";

/**
 * Portal model.
 * Represents a chat session within a station where users interact
 * with the analytics engine via natural language.
 *
 * Sync with the Drizzle `portals` table is enforced at compile
 * time via `apps/api/src/db/schema/type-checks.ts` and at runtime
 * via drizzle-zod derived schemas in `apps/api/src/db/schema/zod.ts`.
 */
export const PortalSchema = CoreSchema.extend({
  organizationId: z.string(),
  stationId: z.string(),
  name: z.string().min(1),
  lastOpened: z.number().nullable(),
});

export type Portal = z.infer<typeof PortalSchema>;

export class PortalModel extends CoreModel<Portal> {
  get schema() {
    return PortalSchema;
  }

  parse(): Portal {
    return this.schema.parse(this._model);
  }

  validate(): z.ZodSafeParseResult<Portal> {
    return this.schema.safeParse(this._model);
  }
}

export class PortalModelFactory extends ModelFactory<Portal, PortalModel> {
  create(createdBy: string): PortalModel {
    const baseModel = this._coreModelFactory.create(createdBy);
    const portalModel = new PortalModel(baseModel.toJSON());
    return portalModel;
  }
}
