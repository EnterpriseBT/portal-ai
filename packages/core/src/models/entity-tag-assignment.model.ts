import { z } from "zod";
import { CoreModel, CoreSchema, ModelFactory } from "./base.model.js";
import type { TagTargetType } from "./tag-target.model.js";

/**
 * A tag on one object (#1070). Exactly one target id is set, mirroring the
 * table's `entity_tag_assignments_one_target` CHECK. The `EntityTag…` name
 * predates the other target types and is kept with the table's.
 */
const EntityTagAssignmentObjectSchema = CoreSchema.extend({
  organizationId: z.string(),
  connectorEntityId: z.string().nullable(),
  stationId: z.string().nullable(),
  portalResultId: z.string().nullable(),
  connectorInstanceId: z.string().nullable(),
  curatedViewId: z.string().nullable(),
  entityTagId: z.string(),
});

/** The assignment field holding each target type's id. */
export const TAG_TARGET_COLUMNS = {
  entity: "connectorEntityId",
  station: "stationId",
  pin: "portalResultId",
  connector_instance: "connectorInstanceId",
  curated_view: "curatedViewId",
} as const satisfies Record<
  TagTargetType,
  keyof z.infer<typeof EntityTagAssignmentObjectSchema>
>;

export const EntityTagAssignmentSchema = EntityTagAssignmentObjectSchema.refine(
  (row) =>
    Object.values(TAG_TARGET_COLUMNS).filter((column) => row[column] != null)
      .length === 1,
  { message: "An assignment has exactly one target" }
);

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
    // Every target starts null; the caller sets exactly one (#1070).
    const entityTagAssignmentModel = new EntityTagAssignmentModel({
      ...baseModel.toJSON(),
      connectorEntityId: null,
      stationId: null,
      portalResultId: null,
      connectorInstanceId: null,
      curatedViewId: null,
    });
    return entityTagAssignmentModel;
  }
}
