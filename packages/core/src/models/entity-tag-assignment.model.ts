import { z } from "zod";
import { CoreModel, CoreSchema, ModelFactory } from "./base.model.js";

export const EntityTagAssignmentSchema = CoreSchema.extend({
  organizationId: z.string(),
  connectorEntityId: z.string(),
  entityTagId: z.string(),
});

export type EntityTagAssignment = z.infer<typeof EntityTagAssignmentSchema>;

export class EntityTagAssignmentModel extends CoreModel<EntityTagAssignment> {
  get schema() {
    return EntityTagAssignmentSchema;
  }

  parse(): EntityTagAssignment {
    return this.schema.parse(this._model);
  }

  validate(): z.ZodSafeParseResult<EntityTagAssignment> {
    return this.schema.safeParse(this._model);
  }
}

export class EntityTagAssignmentModelFactory extends ModelFactory<
  EntityTagAssignment,
  EntityTagAssignmentModel
> {
  create(createdBy: string): EntityTagAssignmentModel {
    const baseModel = this._coreModelFactory.create(createdBy);
    const entityTagAssignmentModel = new EntityTagAssignmentModel(
      baseModel.toJSON()
    );
    return entityTagAssignmentModel;
  }
}
