import { z } from "zod";
import { CoreModel, CoreSchema, ModelFactory } from "./base.model.js";

/**
 * Connector Instances model.
 * Represents a configured instance of a connector definition,
 * scoped to an organization.
 *
 * Sync with the Drizzle `connector_instances` table is enforced at
 * compile time via `apps/api/src/db/schema/type-checks.ts` and at
 * runtime via drizzle-zod derived schemas in
 * `apps/api/src/db/schema/zod.ts`.
 */
export const ConnectorInstanceSchema = CoreSchema.extend({
  connectorDefinitionId: z.string(),
  organizationId: z.string(),
  name: z.string(),
  status: z.enum(["active", "inactive", "error", "pending"]),
  config: z.record(z.string(), z.unknown()).nullable(),
  credentials: z.string().nullable(),
  lastSyncAt: z.number().nullable(),
  lastErrorMessage: z.string().nullable(),
});

export type ConnectorInstance = z.infer<typeof ConnectorInstanceSchema>;

export class ConnectorInstanceModel extends CoreModel<ConnectorInstance> {
  get schema() {
    return ConnectorInstanceSchema;
  }

  parse(): ConnectorInstance {
    return this.schema.parse(this._model);
  }

  validate(): z.ZodSafeParseResult<ConnectorInstance> {
    return this.schema.safeParse(this._model);
  }
}

export class ConnectorInstanceModelFactory extends ModelFactory<
  ConnectorInstance,
  ConnectorInstanceModel
> {
  create(createdBy: string): ConnectorInstanceModel {
    const baseModel = this._coreModelFactory.create(createdBy);
    const connectorInstanceModel = new ConnectorInstanceModel(baseModel.toJSON());
    return connectorInstanceModel;
  }
}
