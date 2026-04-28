import { z } from "zod";
import { CoreModel, CoreSchema, ModelFactory } from "./base.model.js";

/**
 * Column Definitions model.
 * Represents a shared, organization-level field definition that
 * connector entities map their source fields into via FieldMappings.
 *
 * Sync with the Drizzle `column_definitions` table is enforced at
 * compile time via `apps/api/src/db/schema/type-checks.ts` and at
 * runtime via drizzle-zod derived schemas in
 * `apps/api/src/db/schema/zod.ts`.
 */

// ── Column data type enum ────────────────────────────────────────────

export const ColumnDataTypeEnum = z.enum([
  "string",
  "number",
  "boolean",
  "date",
  "datetime",
  "enum",
  "json",
  "array",
  "reference",
  "reference-array",
]);

export type ColumnDataType = z.infer<typeof ColumnDataTypeEnum>;

/**
 * Column data types that support server-side sorting.
 * Used by both the API (to build type-aware ORDER BY expressions)
 * and the frontend (to enable sort controls on column headers).
 */
export const SORTABLE_COLUMN_TYPES: ReadonlySet<ColumnDataType> =
  new Set<ColumnDataType>(["string", "number", "date", "datetime"]);

// ── Schema ───────────────────────────────────────────────────────────

export const ColumnDefinitionSchema = CoreSchema.extend({
  organizationId: z.string(),
  key: z.string().regex(/^[a-z][a-z0-9_]*$/),
  label: z.string(),
  type: ColumnDataTypeEnum,
  description: z.string().nullable(),
  validationPattern: z.string().nullable(),
  validationMessage: z.string().nullable(),
  canonicalFormat: z.string().nullable(),
  system: z.boolean(),
});

export type ColumnDefinition = z.infer<typeof ColumnDefinitionSchema>;

// ── Model class ──────────────────────────────────────────────────────

export class ColumnDefinitionModel extends CoreModel<ColumnDefinition> {
  get schema() {
    return ColumnDefinitionSchema;
  }

  parse(): ColumnDefinition {
    return this.schema.parse(this._model);
  }

  validate(): z.ZodSafeParseResult<ColumnDefinition> {
    return this.schema.safeParse(this._model);
  }
}

// ── Factory ──────────────────────────────────────────────────────────

export class ColumnDefinitionModelFactory extends ModelFactory<
  ColumnDefinition,
  ColumnDefinitionModel
> {
  create(createdBy: string): ColumnDefinitionModel {
    const baseModel = this._coreModelFactory.create(createdBy);
    const columnDefinitionModel = new ColumnDefinitionModel(baseModel.toJSON());
    return columnDefinitionModel;
  }
}
