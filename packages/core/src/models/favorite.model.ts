import { z } from "zod";
import { CoreModel, CoreSchema, ModelFactory } from "./base.model.js";
import type { TagTargetType } from "./tag-target.model.js";

/**
 * The object types a user can favorite (#1072). Each is also a tag target
 * type, and so its own permission resource type: starring needs read on
 * exactly the object it names.
 */
export const FAVORITE_TARGET_TYPES = [
  "station",
  "pin",
  "curated_view",
  "connector_instance",
] as const satisfies readonly TagTargetType[];

export const FavoriteTargetTypeSchema = z.enum(FAVORITE_TARGET_TYPES);
export type FavoriteTargetType = z.infer<typeof FavoriteTargetTypeSchema>;

/** One object a user favorites. */
export const FavoriteTargetSchema = z.object({
  type: FavoriteTargetTypeSchema,
  id: z.string(),
});
export type FavoriteTarget = z.infer<typeof FavoriteTargetSchema>;

/**
 * One user's favorite of one object (#1072). Personal: only its user reads
 * it. Exactly one target id is set, mirroring the table's
 * `favorites_one_target` CHECK. Rows are hard-deleted, so `deleted` is
 * always null.
 */
const FavoriteObjectSchema = CoreSchema.extend({
  organizationId: z.string(),
  userId: z.string(),
  stationId: z.string().nullable(),
  portalResultId: z.string().nullable(),
  curatedViewId: z.string().nullable(),
  connectorInstanceId: z.string().nullable(),
});

/** The favorite field holding each target type's id. */
export const FAVORITE_TARGET_COLUMNS = {
  station: "stationId",
  pin: "portalResultId",
  curated_view: "curatedViewId",
  connector_instance: "connectorInstanceId",
} as const satisfies Record<
  FavoriteTargetType,
  keyof z.infer<typeof FavoriteObjectSchema>
>;

export const FavoriteSchema = FavoriteObjectSchema.refine(
  (row) =>
    Object.values(FAVORITE_TARGET_COLUMNS).filter(
      (column) => row[column] != null
    ).length === 1,
  { message: "A favorite names exactly one object" }
);

export type Favorite = z.infer<typeof FavoriteSchema>;

export class FavoriteModel extends CoreModel<Favorite> {
  get schema() {
    return FavoriteSchema;
  }

  parse(): Favorite {
    return this.schema.parse(this._model);
  }

  validate(): z.ZodSafeParseResult<Favorite> {
    return this.schema.safeParse(this._model);
  }
}

export class FavoriteModelFactory extends ModelFactory<
  Favorite,
  FavoriteModel
> {
  create(createdBy: string): FavoriteModel {
    const baseModel = this._coreModelFactory.create(createdBy);
    // Every target starts null; the caller sets exactly one.
    return new FavoriteModel({
      ...baseModel.toJSON(),
      stationId: null,
      portalResultId: null,
      curatedViewId: null,
      connectorInstanceId: null,
    });
  }
}
