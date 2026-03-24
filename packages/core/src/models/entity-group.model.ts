import { z } from "zod";
import { CoreModel, CoreSchema, ModelFactory } from "./base.model.js";

/**
 * Entity Group model.
 * Represents a logical grouping of entities from different connector
 * instances that share a common identity (e.g., the same person
 * appearing across multiple data sources).
 *
 * Sync with the Drizzle `entity_groups` table is enforced at compile
 * time via `apps/api/src/db/schema/type-checks.ts` and at runtime
 * via drizzle-zod derived schemas in `apps/api/src/db/schema/zod.ts`.
 */
export const EntityGroupSchema = CoreSchema.extend({
  organizationId: z.string(),
  name: z.string().min(1),
  description: z.string().nullable(),
});

export type EntityGroup = z.infer<typeof EntityGroupSchema>;

// ── Model class ──────────────────────────────────────────────────────

export class EntityGroupModel extends CoreModel<EntityGroup> {
  get schema() {
    return EntityGroupSchema;
  }

  parse(): EntityGroup {
    return this.schema.parse(this._model);
  }

  validate(): z.ZodSafeParseResult<EntityGroup> {
    return this.schema.safeParse(this._model);
  }
}

// ── Factory ──────────────────────────────────────────────────────────

export class EntityGroupModelFactory extends ModelFactory<
  EntityGroup,
  EntityGroupModel
> {
  create(createdBy: string): EntityGroupModel {
    const baseModel = this._coreModelFactory.create(createdBy);
    const entityGroupModel = new EntityGroupModel(baseModel.toJSON());
    return entityGroupModel;
  }
}
