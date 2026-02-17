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
export const CoreSchema = z.object({
  id: z.string(),
  created: z.number(),
  createdBy: z.string(),
  updated: z.number().nullable(),
  updatedBy: z.string().nullable(),
  deleted: z.number().nullable(),
  deletedBy: z.string().nullable(),
});

export type Core = z.infer<typeof CoreSchema>;

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

export class CoreModel<T extends Core> extends AbstractModel<T> {
  get schema() {
    return CoreSchema;
  }
}

export interface CoreModelFactoryOptions {
  idFactory?: IDFactory;
  dateFactory: DateFactory;
}

export class CoreModelFactory {
  protected _idFactory: IDFactory;
  protected _dateFactory: DateFactory;

  constructor(options: CoreModelFactoryOptions) {
    const { idFactory = new UUIDv4Factory(), dateFactory } = options;
    this._idFactory = idFactory;
    this._dateFactory = dateFactory;
  }

  create(createdBy: string) {
    const id = this._idFactory.generate();
    const timestamp = this._dateFactory.now();
    const baseData: Partial<Core> = {
      id,
      created: timestamp.getTime(),
      createdBy,
    };
    const baseModel = new CoreModel(baseData);
    return baseModel;
  }
}

export interface ModelFactoryOptions {
  coreModelFactory: CoreModelFactory;
}

export abstract class ModelFactory<T, M extends AbstractModel<T>> {
  _coreModelFactory: CoreModelFactory;
  constructor(options: ModelFactoryOptions) {
    this._coreModelFactory = options.coreModelFactory;
  }

  abstract create(createdBy: string): M;
}
