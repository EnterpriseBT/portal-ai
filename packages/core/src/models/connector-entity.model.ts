import { z } from "zod";
import { CoreModel, CoreSchema, ModelFactory } from "./base.model.js";

/**
 * Connector Entities model.
 * Represents a distinct data object exposed by a connector instance
 * (e.g. "Contacts", "Deals", "Users").
 *
 * Sync with the Drizzle `connector_entities` table is enforced at
 * compile time via `apps/api/src/db/schema/type-checks.ts` and at
 * runtime via drizzle-zod derived schemas in
 * `apps/api/src/db/schema/zod.ts`.
 */
export const ConnectorEntitySchema = CoreSchema.extend({
  connectorInstanceId: z.string(),
  key: z.string().regex(/^[a-z][a-z0-9_]*$/),
  label: z.string(),
});

export type ConnectorEntity = z.infer<typeof ConnectorEntitySchema>;

// ── Model class ──────────────────────────────────────────────────────

export class ConnectorEntityModel extends CoreModel<ConnectorEntity> {
  get schema() {
    return ConnectorEntitySchema;
  }

  parse(): ConnectorEntity {
    return this.schema.parse(this._model);
  }

  validate(): z.ZodSafeParseResult<ConnectorEntity> {
    return this.schema.safeParse(this._model);
  }
}

// ── Factory ──────────────────────────────────────────────────────────

export class ConnectorEntityModelFactory extends ModelFactory<
  ConnectorEntity,
  ConnectorEntityModel
> {
  create(createdBy: string): ConnectorEntityModel {
    const baseModel = this._coreModelFactory.create(createdBy);
    const connectorEntityModel = new ConnectorEntityModel(baseModel.toJSON());
    return connectorEntityModel;
  }
}
