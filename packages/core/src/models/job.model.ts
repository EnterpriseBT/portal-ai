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
  "awaiting_confirmation",
]);
export type JobStatus = z.infer<typeof JobStatusEnum>;

/** Statuses that indicate a job has reached a final state and will not change further. */
export const TERMINAL_JOB_STATUSES: JobStatus[] = [
  "completed",
  "failed",
  "cancelled",
];

export const JobTypeEnum = z.enum(["system_check", "revalidation"]);
export type JobType = z.infer<typeof JobTypeEnum>;

// --- Per-Type Metadata & Result Schemas ---

/** system_check — diagnostic job with no input, returns health summary. */
export const SystemCheckMetadataSchema = z.object({});
export type SystemCheckMetadata = z.infer<typeof SystemCheckMetadataSchema>;

export const SystemCheckResultSchema = z.object({
  status: z.string(),
  checks: z.record(z.string(), z.string()),
  durationMs: z.number(),
});
export type SystemCheckResult = z.infer<typeof SystemCheckResultSchema>;

/** revalidation — re-runs normalization pipeline on all records for an entity. */
export const RevalidationMetadataSchema = z.object({
  connectorEntityId: z.string(),
  organizationId: z.string(),
});
export type RevalidationMetadata = z.infer<typeof RevalidationMetadataSchema>;

export const RevalidationResultSchema = z.object({
  total: z.number(),
  valid: z.number(),
  invalid: z.number(),
  errors: z.array(
    z.object({
      recordId: z.string(),
      errors: z.array(z.object({ field: z.string(), error: z.string() })),
    })
  ),
});
export type RevalidationResult = z.infer<typeof RevalidationResultSchema>;

// --- Type Map ---

/**
 * Maps each job type to its strongly-typed metadata and result shapes.
 *
 * When adding a new job type:
 * 1. Add the type string to `JobTypeEnum`
 * 2. Define `<Type>MetadataSchema` and `<Type>ResultSchema` above
 * 3. Add an entry here — TypeScript will error if `JOB_TYPE_SCHEMAS` is incomplete
 */
export interface JobTypeMap {
  system_check: { metadata: SystemCheckMetadata; result: SystemCheckResult };
  revalidation: { metadata: RevalidationMetadata; result: RevalidationResult };
}

/**
 * Runtime Zod schema registry — keyed by job type.
 * Used for validating metadata at the API boundary and processor results.
 */
export const JOB_TYPE_SCHEMAS: {
  [K in JobType]: {
    metadata: z.ZodType<JobTypeMap[K]["metadata"]>;
    result: z.ZodType<JobTypeMap[K]["result"]>;
  };
} = {
  system_check: {
    metadata: SystemCheckMetadataSchema,
    result: SystemCheckResultSchema,
  },
  revalidation: {
    metadata: RevalidationMetadataSchema,
    result: RevalidationResultSchema,
  },
};

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
  static readonly TERMINAL_STATUSES: readonly JobStatus[] =
    TERMINAL_JOB_STATUSES;

  static isTerminalStatus(status: JobStatus): boolean {
    return TERMINAL_JOB_STATUSES.includes(status);
  }

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

