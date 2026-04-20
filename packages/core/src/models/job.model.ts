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

export const JobTypeEnum = z.enum([
  "file_upload",
  "system_check",
  "revalidation",
]);
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

/** file_upload — CSV file import jobs via S3 presigned uploads. */
export const FileUploadFileSchema = z.object({
  originalName: z.string(),
  s3Key: z.string(),
  sizeBytes: z.number(),
});
export type FileUploadFile = z.infer<typeof FileUploadFileSchema>;

export const FileUploadMetadataSchema = z.object({
  files: z.array(FileUploadFileSchema),
  organizationId: z.string(),
  connectorDefinitionId: z.string(),
});
export type FileUploadMetadata = z.infer<typeof FileUploadMetadataSchema>;

/** Per-column statistics accumulated during CSV parsing. */
export const ColumnStatSchema = z.object({
  name: z.string(),
  nullCount: z.number(),
  totalCount: z.number(),
  nullRate: z.number(),
  uniqueCount: z.number(),
  uniqueCapped: z.boolean(),
  minLength: z.number(),
  maxLength: z.number(),
  sampleValues: z.array(z.string()),
});
export type ColumnStat = z.infer<typeof ColumnStatSchema>;

/** Per-file parse result produced by the CSV parsing phase. */
export const FileParseResultSchema = z.object({
  fileName: z.string(),
  delimiter: z.string(),
  hasHeader: z.boolean(),
  encoding: z.string(),
  rowCount: z.number(),
  headers: z.array(z.string()),
  sampleRows: z.array(z.array(z.string())),
  columnStats: z.array(ColumnStatSchema),
});
export type FileParseResult = z.infer<typeof FileParseResultSchema>;

/** Per-column recommendation produced by AI analysis or heuristic fallback. */
export const FileUploadColumnRecommendationSchema = z.object({
  /** Source column name from the CSV header. */
  sourceField: z.string(),
  /** ID of the matched existing column definition. */
  existingColumnDefinitionId: z.string(),
  /** Key of the matched existing column definition. */
  existingColumnDefinitionKey: z.string(),
  /** Confidence score for the recommendation (0-1). */
  confidence: z.number().min(0).max(1),
  /** Sample values from the parsed data. */
  sampleValues: z.array(z.string()),
  /** Optional format hint (e.g. "YYYY-MM-DD", "email", "url"). Mapping-level. */
  format: z.string().nullable(),
  /** Whether this column is a candidate primary key. */
  isPrimaryKey: z.boolean(),
  /** Whether the column should be required. Mapping-level. */
  required: z.boolean(),
  /** Key used in normalizedData. Mapping-level. */
  normalizedKey: z.string().optional(),
  /** Default fill value when source value is missing. Mapping-level. */
  defaultValue: z.string().nullable().optional(),
  /** Allowed values for enum-like columns. Mapping-level. */
  enumValues: z.array(z.string()).nullable().optional(),
});
export type FileUploadColumnRecommendation = z.infer<
  typeof FileUploadColumnRecommendationSchema
>;

/** Per-file entity recommendation produced by AI analysis. */
export const FileUploadRecommendationEntitySchema = z.object({
  /** Recommended connector entity key (snake_case). */
  entityKey: z.string(),
  /** Human-readable entity label. */
  entityLabel: z.string(),
  /** Source file name this recommendation is derived from. */
  sourceFileName: z.string(),
  /** Column-level recommendations. */
  columns: z.array(FileUploadColumnRecommendationSchema),
});
export type FileUploadRecommendationEntity = z.infer<
  typeof FileUploadRecommendationEntitySchema
>;

/** Top-level recommendation payload. */
export const FileUploadRecommendationSchema = z.object({
  /** Suggested connector instance name. */
  connectorInstanceName: z.string(),
  /** Per-file entity recommendations. */
  entities: z.array(FileUploadRecommendationEntitySchema),
});
export type FileUploadRecommendation = z.infer<
  typeof FileUploadRecommendationSchema
>;

export const FileUploadResultSchema = z.object({
  parseResults: z.array(FileParseResultSchema).optional(),
  recommendations: FileUploadRecommendationSchema.optional(),
});
export type FileUploadResult = z.infer<typeof FileUploadResultSchema>;

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
  file_upload: { metadata: FileUploadMetadata; result: FileUploadResult };
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
  file_upload: {
    metadata: FileUploadMetadataSchema,
    result: FileUploadResultSchema,
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

// --- Typed Job: file_upload -----------------------------------------------

/**
 * A `Job` with `metadata` and `result` narrowed to the file_upload type.
 * Use for construction and service-layer code; the DB layer still uses `Job`.
 */
export interface FileUploadJob extends Omit<
  Job,
  "type" | "metadata" | "result"
> {
  type: "file_upload";
  metadata: FileUploadMetadata;
  result: FileUploadResult | null;
}

/**
 * Typed model for file_upload jobs.
 *
 * Provides a `fileUploadMetadata` getter that returns strongly-typed metadata
 * without casting, and a `createForUpload()` static helper that pre-fills
 * all job-level defaults so callers only supply the upload-specific fields.
 */
export class FileUploadJobModel extends JobModel {
  /** Strongly-typed accessor for file_upload metadata. */
  get fileUploadMetadata(): FileUploadMetadata {
    return FileUploadMetadataSchema.parse(this._model.metadata);
  }
}

export interface CreateFileUploadJobParams {
  organizationId: string;
  connectorDefinitionId: string;
  files: FileUploadFile[];
}

/**
 * Factory that produces a fully-initialised `FileUploadJobModel` from just
 * the upload-specific fields.  All generic job defaults (`status`, `progress`,
 * `attempts`, …) are set automatically.
 */
export class FileUploadJobModelFactory extends ModelFactory<
  Job,
  FileUploadJobModel
> {
  create(createdBy: string): FileUploadJobModel {
    const baseModel = this._coreModelFactory.create(createdBy);
    return new FileUploadJobModel(baseModel.toJSON());
  }

  /**
   * Create a pending file_upload job with typed metadata.
   * Returns a model ready to be `parse()`d and inserted into the DB.
   */
  createForUpload(
    createdBy: string,
    params: CreateFileUploadJobParams
  ): FileUploadJobModel {
    const model = this.create(createdBy);

    const metadata: FileUploadMetadata = {
      files: params.files,
      organizationId: params.organizationId,
      connectorDefinitionId: params.connectorDefinitionId,
    };

    model.update({
      organizationId: params.organizationId,
      type: "file_upload",
      status: "pending",
      progress: 0,
      metadata: metadata as Record<string, unknown>,
      result: null,
      error: null,
      startedAt: null,
      completedAt: null,
      bullJobId: null,
      attempts: 0,
      maxAttempts: 3,
    });

    return model;
  }
}
