import { z } from "zod";
import { CoreModel, CoreSchema, ModelFactory } from "./base.model.js";

/**
 * Field Mappings model.
 * Maps a source field name from a connector entity to a shared
 * column definition.
 *
 * Sync with the Drizzle `field_mappings` table is enforced at
 * compile time via `apps/api/src/db/schema/type-checks.ts` and at
 * runtime via drizzle-zod derived schemas in
 * `apps/api/src/db/schema/zod.ts`.
 */
export const FieldMappingSchema = CoreSchema.extend({
  organizationId: z.string(),
  connectorEntityId: z.string(),
  columnDefinitionId: z.string(),
  sourceField: z.string(),
  isPrimaryKey: z.boolean(),
});

export type FieldMapping = z.infer<typeof FieldMappingSchema>;

// ── Model class ──────────────────────────────────────────────────────

export class FieldMappingModel extends CoreModel<FieldMapping> {
  get schema() {
    return FieldMappingSchema;
  }

  parse(): FieldMapping {
    return this.schema.parse(this._model);
  }

  validate(): z.ZodSafeParseResult<FieldMapping> {
    return this.schema.safeParse(this._model);
  }
}

// ── Factory ──────────────────────────────────────────────────────────

export class FieldMappingModelFactory extends ModelFactory<
  FieldMapping,
  FieldMappingModel
> {
  create(createdBy: string): FieldMappingModel {
    const baseModel = this._coreModelFactory.create(createdBy);
    const fieldMappingModel = new FieldMappingModel(baseModel.toJSON());
    return fieldMappingModel;
  }
}
