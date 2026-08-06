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
  // #316: geometry is a real, typed, SRID-constrained, GiST-indexed column
  // under PostGIS — the storage genuinely differs from json, which is why it
  // earns a type rather than a role annotation.
  "geometry",
]);

export type ColumnDataType = z.infer<typeof ColumnDataTypeEnum>;

/**
 * Geospatial role annotation (#316). Applies only to coordinate-pair columns —
 * a `lat`/`lng` pair really is just two numbers, so it carries a role rather
 * than a type. Geometry is a *type* (`ColumnDataTypeEnum`), never a role, so
 * this enum deliberately does not include `"geometry"`.
 */
export const GeoRoleSchema = z.enum(["lat", "lng"]);

export type GeoRole = z.infer<typeof GeoRoleSchema>;

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
  /** Coordinate-pair role (#316); null for every non-coordinate column,
   *  including geometry (which is a type, not a role). */
  geoRole: GeoRoleSchema.nullable(),
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
