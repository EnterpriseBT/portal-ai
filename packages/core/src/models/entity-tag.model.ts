import { z } from "zod";
import { CoreModel, CoreSchema, ModelFactory } from "./base.model.js";
import { SourcePortalIdSchema } from "./provenance.model.js";

export const EntityTagSchema = CoreSchema.extend({
  organizationId: z.string(),
  name: z.string().min(1),
  color: z.string().nullable(),
  description: z.string().nullable(),
  /** #1071: the portal session that created the tag, if any (#641). */
  sourcePortalId: SourcePortalIdSchema,
});

export type EntityTag = z.infer<typeof EntityTagSchema>;

export class EntityTagModel extends CoreModel<EntityTag> {
  get schema() {
    return EntityTagSchema;
  }

  parse(): EntityTag {
    return this.schema.parse(this._model);
  }

  validate(): z.ZodSafeParseResult<EntityTag> {
    return this.schema.safeParse(this._model);
  }
}

export class EntityTagModelFactory extends ModelFactory<
  EntityTag,
  EntityTagModel
> {
  create(createdBy: string): EntityTagModel {
    const baseModel = this._coreModelFactory.create(createdBy);
    const entityTagModel = new EntityTagModel(baseModel.toJSON());
    return entityTagModel;
  }
}
