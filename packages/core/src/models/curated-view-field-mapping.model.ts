import { z } from "zod";
import { CoreModel, CoreSchema, ModelFactory } from "./base.model.js";

/**
 * Curated-view ↔ field-mapping projection join (#599).
 *
 * Each row places one field mapping (a column) into a curated view's
 * projection. The join table is also what the `in_curated_view` FK
 * condition (grants) expands against.
 *
 * Sync with the Drizzle `curated_view_field_mappings` table is enforced
 * at compile time via `apps/api/src/db/schema/type-checks.ts` and at
 * runtime via drizzle-zod derived schemas in
 * `apps/api/src/db/schema/zod.ts`.
 */
export const CuratedViewFieldMappingSchema = CoreSchema.extend({
  organizationId: z.string(),
  curatedViewId: z.string(),
  fieldMappingId: z.string(),
});

export type CuratedViewFieldMapping = z.infer<
  typeof CuratedViewFieldMappingSchema
>;

export class CuratedViewFieldMappingModel extends CoreModel<CuratedViewFieldMapping> {
  get schema() {
    return CuratedViewFieldMappingSchema;
  }

  parse(): CuratedViewFieldMapping {
    return this.schema.parse(this._model);
  }

  validate(): z.ZodSafeParseResult<CuratedViewFieldMapping> {
    return this.schema.safeParse(this._model);
  }
}

export class CuratedViewFieldMappingModelFactory extends ModelFactory<
  CuratedViewFieldMapping,
  CuratedViewFieldMappingModel
> {
  create(createdBy: string): CuratedViewFieldMappingModel {
    const baseModel = this._coreModelFactory.create(createdBy);
    const model = new CuratedViewFieldMappingModel(baseModel.toJSON());
    return model;
  }
}
