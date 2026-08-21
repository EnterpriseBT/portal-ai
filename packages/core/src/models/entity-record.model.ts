import { z } from "zod";
import { CoreModel, CoreSchema, ModelFactory } from "./base.model.js";

/**
 * Entity Records model.
 * Represents a single data row belonging to a connector entity.
 * Stores both the raw source data and a normalized version mapped
 * through field mappings / column definitions.
 *
 * Sync with the Drizzle `entity_records` table is enforced at
 * compile time via `apps/api/src/db/schema/type-checks.ts` and at
 * runtime via drizzle-zod derived schemas in
 * `apps/api/src/db/schema/zod.ts`.
 */
export const EntityRecordOriginSchema = z.enum(["sync", "manual", "portal"]);

export type EntityRecordOrigin = z.infer<typeof EntityRecordOriginSchema>;

export const EntityRecordSchema = CoreSchema.extend({
  organizationId: z.string(),
  connectorEntityId: z.string(),
  data: z.record(z.string(), z.unknown()),
  normalizedData: z.record(z.string(), z.unknown()),
  sourceId: z.string(),
  checksum: z.string(),
  syncedAt: z.number(),
  origin: EntityRecordOriginSchema.default("manual"),
  validationErrors: z
    .array(z.object({ field: z.string(), error: z.string() }))
    .nullable(),
  isValid: z.boolean(),
});

export type EntityRecord = z.infer<typeof EntityRecordSchema>;

/**
 * The list projection (#433) — every field except the raw `data` payload.
 *
 * `data` is the connector's pre-mapping payload, preserved as the audit
 * trail and read by the record-detail view. In a *list* it is dead weight:
 * the table renders from `normalizedData`, yet `data` made the list query's
 * hash side 1101 bytes wide and spilled it to 64 disk batches before
 * discarding all but ten rows.
 *
 * Narrowing the list schema rather than making `data` optional on
 * `EntityRecordSchema` is deliberate: the detail path keeps its guarantee,
 * and `tsc` names every call site that would lose the field instead of
 * letting one silently read `undefined`.
 */
export const EntityRecordListItemSchema = EntityRecordSchema.omit({
  data: true,
});

export type EntityRecordListItem = z.infer<typeof EntityRecordListItemSchema>;

// ── Model class ──────────────────────────────────────────────────────

export class EntityRecordModel extends CoreModel<EntityRecord> {
  get schema() {
    return EntityRecordSchema;
  }

  parse(): EntityRecord {
    return this.schema.parse(this._model);
  }

  validate(): z.ZodSafeParseResult<EntityRecord> {
    return this.schema.safeParse(this._model);
  }
}

// ── Factory ──────────────────────────────────────────────────────────

export class EntityRecordModelFactory extends ModelFactory<
  EntityRecord,
  EntityRecordModel
> {
  create(createdBy: string): EntityRecordModel {
    const baseModel = this._coreModelFactory.create(createdBy);
    const entityRecordModel = new EntityRecordModel(baseModel.toJSON());
    return entityRecordModel;
  }
}
