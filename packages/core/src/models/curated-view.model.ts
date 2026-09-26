import { z } from "zod";
import { CoreModel, CoreSchema, ModelFactory } from "./base.model.js";

/**
 * Curated View model (#599).
 *
 * A per-entity curated slice of connector data — the read/exposure object
 * members are granted (`read curated_view:<id>`) instead of a raw entity.
 * Its **row filter** is a validated SQL boolean expression (`whereClause`,
 * null = all rows); its **column projection** is the set of field mappings
 * in the `curated_view_field_mappings` join table (no rows = all of the
 * entity's current columns — an unrestricted view). There is no
 * `isPassthrough` flag: an unrestricted view is simply one with no
 * projection rows and a null `whereClause`.
 *
 * Sync with the Drizzle `curated_views` table is enforced at compile time
 * via `apps/api/src/db/schema/type-checks.ts` and at runtime via drizzle-zod
 * derived schemas in `apps/api/src/db/schema/zod.ts`.
 */
export const CuratedViewSchema = CoreSchema.extend({
  organizationId: z.string(),
  connectorEntityId: z.string(),
  /** Per-org-unique; becomes the session/queryable view name. */
  key: z.string().min(1),
  label: z.string().min(1),
  description: z.string().nullable(),
  /** Validated SQL boolean expression; null = no row filter (all rows). */
  whereClause: z.string().nullable(),
});

export type CuratedView = z.infer<typeof CuratedViewSchema>;

// ── Model class ──────────────────────────────────────────────────────

export class CuratedViewModel extends CoreModel<CuratedView> {
  get schema() {
    return CuratedViewSchema;
  }

  parse(): CuratedView {
    return this.schema.parse(this._model);
  }

  validate(): z.ZodSafeParseResult<CuratedView> {
    return this.schema.safeParse(this._model);
  }
}

// ── Factory ──────────────────────────────────────────────────────────

export class CuratedViewModelFactory extends ModelFactory<
  CuratedView,
  CuratedViewModel
> {
  create(createdBy: string): CuratedViewModel {
    const baseModel = this._coreModelFactory.create(createdBy);
    const curatedViewModel = new CuratedViewModel(baseModel.toJSON());
    return curatedViewModel;
  }
}
