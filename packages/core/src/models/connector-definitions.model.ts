import { z } from "zod";
import { CoreModel, CoreSchema, ModelFactory } from "./base.model.js";

/**
 * Connector Definitions model.
 * Extends CoreModel with connector-specific metadata fields.
 *
 * Sync with the Drizzle `connector_definitions` table is enforced at
 * compile time via `apps/api/src/db/schema/type-checks.ts` and at
 * runtime via drizzle-zod derived schemas in
 * `apps/api/src/db/schema/zod.ts`.
 */
export const ConnectorDefinitionsSchema = CoreSchema.extend({
  slug: z.string(),
  display: z.string(),
  category: z.string(),
  authType: z.string(),
  configSchema: z.record(z.string(), z.unknown()).nullable(),
  capabilityFlags: z.object({
    sync: z.boolean().optional(),
    query: z.boolean().optional(),
    write: z.boolean().optional(),
  }),
  isActive: z.boolean(),
  version: z.string(),
  iconUrl: z.string().nullable(),
});

export type ConnectorDefinitions = z.infer<typeof ConnectorDefinitionsSchema>;

export class ConnectorDefinitionsModel extends CoreModel<ConnectorDefinitions> {
  get schema() {
    return ConnectorDefinitionsSchema;
  }

  parse(): ConnectorDefinitions {
    return this.schema.parse(this._model);
  }

  validate(): z.ZodSafeParseResult<ConnectorDefinitions> {
    return this.schema.safeParse(this._model);
  }
}

export class ConnectorDefinitionsModelFactory extends ModelFactory<
  ConnectorDefinitions,
  ConnectorDefinitionsModel
> {
  create(createdBy: string): ConnectorDefinitionsModel {
    const baseModel = this._coreModelFactory.create(createdBy);
    const connectorDefinitionsModel = new ConnectorDefinitionsModel(baseModel.toJSON());
    return connectorDefinitionsModel;
  }
}
