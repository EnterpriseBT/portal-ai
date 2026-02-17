import _ from "lodash";
import { z } from "zod";

/**
 * Base schema for all database models.
 *
 * Every persisted entity extends this schema which provides standard
 * audit fields for tracking creation, modification, and soft-deletion.
 *
 * Sync with the Drizzle table columns is enforced at compile time
 * via `apps/api/src/db/schema/type-checks.ts`.
 */
export const BaseModelSchema = z.object({
  id: z.string(),
  created: z.number(),
  createdBy: z.string(),
  updated: z.number().nullable(),
  updatedBy: z.string().nullable(),
  deleted: z.number().nullable(),
  deletedBy: z.string().nullable(),
});

export type BaseModel = z.infer<typeof BaseModelSchema>;

export abstract class AbstractModel<T> {
  protected _model: Partial<T>;

  constructor(data?: Partial<T>) {
    this._model = data || {};
  }

  abstract get schema(): z.ZodTypeAny;

  toJSON(): Partial<T> {
    return JSON.parse(JSON.stringify(this._model));
  }

  validate() {
    return this.schema.safeParse(this._model);
  }

  update(data: Partial<T>) {
    this._model = _.merge({}, this._model, data);
    return this;
  }
}

export class BaseModelClass<T extends BaseModel> extends AbstractModel<T> {
  get schema() {
    return BaseModelSchema;
  }
}
