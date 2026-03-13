import { z } from "zod";
import { CoreModel, CoreSchema, ModelFactory } from "./base.model.js";

/**
 * Async job model.
 * Represents a long-running background job (e.g., data import,
 * connector sync, report generation) tracked in PostgreSQL and
 * processed via BullMQ.
 *
 * Sync with the Drizzle `jobs` table is enforced at compile time
 * via `apps/api/src/db/schema/type-checks.ts` and at runtime via
 * drizzle-zod derived schemas in `apps/api/src/db/schema/zod.ts`.
 */

// --- Enums ---

export const JobStatusEnum = z.enum([
  "pending",
  "active",
  "completed",
  "failed",
  "stalled",
  "cancelled",
]);
export type JobStatus = z.infer<typeof JobStatusEnum>;

export const JobTypeEnum = z.enum([
  "file_upload",
]);
export type JobType = z.infer<typeof JobTypeEnum>;

// --- Schema ---

export const JobSchema = CoreSchema.extend({
  organizationId: z.string(),
  type: JobTypeEnum,
  status: JobStatusEnum,
  progress: z.number(),
  metadata: z.record(z.string(), z.unknown()),
  result: z.record(z.string(), z.unknown()).nullable(),
  error: z.string().nullable(),
  startedAt: z.number().nullable(),
  completedAt: z.number().nullable(),
  bullJobId: z.string().nullable(),
  attempts: z.number(),
  maxAttempts: z.number(),
});

export type Job = z.infer<typeof JobSchema>;

// --- Model Class ---

export class JobModel extends CoreModel<Job> {
  get schema() {
    return JobSchema;
  }

  parse(): Job {
    return this.schema.parse(this._model);
  }

  validate(): z.ZodSafeParseResult<Job> {
    return this.schema.safeParse(this._model);
  }
}

// --- Factory ---

export class JobModelFactory extends ModelFactory<Job, JobModel> {
  create(createdBy: string): JobModel {
    const baseModel = this._coreModelFactory.create(createdBy);
    const jobModel = new JobModel(baseModel.toJSON());
    return jobModel;
  }
}
