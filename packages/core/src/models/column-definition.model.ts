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
]);

export type ColumnDataType = z.infer<typeof ColumnDataTypeEnum>;

// ── Schema ───────────────────────────────────────────────────────────

export const ColumnDefinitionSchema = CoreSchema.extend({
  organizationId: z.string(),
  key: z.string().regex(/^[a-z][a-z0-9_]*$/),
  label: z.string(),
  type: ColumnDataTypeEnum,
  required: z.boolean(),
  defaultValue: z.string().nullable(),
  format: z.string().nullable(),
  enumValues: z.array(z.string()).nullable(),
  description: z.string().nullable(),

  // Reference fields (when type is "reference")
  refColumnDefinitionId: z.string().nullable(),
  refEntityKey: z.string().nullable(),
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
