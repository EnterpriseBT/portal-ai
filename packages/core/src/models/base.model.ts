import _ from "lodash";
import { z } from "zod";
import { DateFactory, IDFactory, UUIDv4Factory } from "../utils/index.js";

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

export interface BaseModelFactoryOptions {
  idFactory?: IDFactory;
  dateFactory: DateFactory;
}

export class BaseModelFactory {
  protected _idFactory: IDFactory;
  protected _dateFactory: DateFactory;

  constructor(options: BaseModelFactoryOptions) {
    const { idFactory = new UUIDv4Factory(), dateFactory } = options;
    this._idFactory = idFactory;
    this._dateFactory = dateFactory;
  }

  create(createdBy: string) {
    const id = this._idFactory.generate();
    const timestamp = this._dateFactory.now();
    const baseData: Partial<BaseModel> = {
      id,
      created: timestamp.getTime(),
      createdBy,
    };
    const baseModel = new BaseModelClass(baseData);
    return baseModel;
  }
}

export interface ModelFactoryOptions {
  baseModelFactory: BaseModelFactory;
}

export abstract class ModelFactory<T, M extends AbstractModel<T>> {
  _baseModelFactory: BaseModelFactory;
  constructor(options: ModelFactoryOptions) {
    this._baseModelFactory = options.baseModelFactory;
  }

  abstract create(createdBy: string): M;
}
