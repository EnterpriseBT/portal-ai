import { z } from "zod";
import { CoreModel, CoreSchema, ModelFactory } from "./base.model.js";

/**
 * Entity Group Member model.
 * Represents a single entity's membership in an entity group,
 * including the link field mapping used for identity resolution.
 *
 * Sync with the Drizzle `entity_group_members` table is enforced at
 * compile time via `apps/api/src/db/schema/type-checks.ts` and at
 * runtime via drizzle-zod derived schemas in
 * `apps/api/src/db/schema/zod.ts`.
 */
export const EntityGroupMemberSchema = CoreSchema.extend({
  organizationId: z.string(),
  entityGroupId: z.string(),
  connectorEntityId: z.string(),
  linkFieldMappingId: z.string(),
  isPrimary: z.boolean().default(false),
});

export type EntityGroupMember = z.infer<typeof EntityGroupMemberSchema>;

// ── Model class ──────────────────────────────────────────────────────

export class EntityGroupMemberModel extends CoreModel<EntityGroupMember> {
  get schema() {
    return EntityGroupMemberSchema;
  }

  parse(): EntityGroupMember {
    return this.schema.parse(this._model);
  }

  validate(): z.ZodSafeParseResult<EntityGroupMember> {
    return this.schema.safeParse(this._model);
  }
}

// ── Factory ──────────────────────────────────────────────────────────

export class EntityGroupMemberModelFactory extends ModelFactory<
  EntityGroupMember,
  EntityGroupMemberModel
> {
  create(createdBy: string): EntityGroupMemberModel {
    const baseModel = this._coreModelFactory.create(createdBy);
    const entityGroupMemberModel = new EntityGroupMemberModel(
      baseModel.toJSON()
    );
    return entityGroupMemberModel;
  }
}
