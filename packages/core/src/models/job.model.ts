import { z } from "zod";
import { CoreModel, CoreSchema, ModelFactory } from "./base.model.js";
import { ApiErrorSchema } from "../contracts/api.contract.js";
import { DEFAULT_BULK_BATCH } from "../constants/large-data-ops.constants.js";

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
  "system_check",
  "revalidation",
  "connector_sync",
  "file_upload_parse",
  "layout_plan_commit",
  "bulk_transform",
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

/**
 * connector_sync — generic per-instance sync. The shared sync route
 * resolves the connector adapter via the instance's definition slug
 * and dispatches the full pipeline to `adapter.syncInstance`. Used by
 * every sync-capable connector (gsheets, future Microsoft Excel,
 * future SQL/database, etc.) — the metadata + result shape are
 * connector-agnostic.
 */
export const ConnectorSyncMetadataSchema = z.object({
  connectorInstanceId: z.string(),
  organizationId: z.string(),
  userId: z.string(),
});
export type ConnectorSyncMetadata = z.infer<typeof ConnectorSyncMetadataSchema>;

export const ConnectorSyncResultSchema = z.object({
  recordCounts: z.object({
    created: z.number().int().nonnegative(),
    updated: z.number().int().nonnegative(),
    unchanged: z.number().int().nonnegative(),
    deleted: z.number().int().nonnegative(),
  }),
});
export type ConnectorSyncResult = z.infer<typeof ConnectorSyncResultSchema>;

/**
 * file_upload_parse — drives the streaming parse of one or more uploads
 * into the chunked workbook cache. The HTTP route mints `uploadSessionId`
 * + the job, returns 202 immediately, and the worker streams every
 * upload from S3 via the chunked-cache adapters. On completion the
 * worker publishes the same preview payload the synchronous endpoint
 * used to return inline (`FileUploadParseJobResult` in
 * `contracts/file-uploads.contract.ts`); the frontend awaits it via
 * the existing `/api/sse/jobs/:id/events` stream. See
 * `docs/LARGE_FILE_PARSE_STREAMING.plan.md` §Phase 3.
 */
export const FileUploadParseMetadataSchema = z.object({
  organizationId: z.string(),
  uploadSessionId: z.string(),
  uploadIds: z.array(z.string()).min(1),
});
export type FileUploadParseMetadata = z.infer<
  typeof FileUploadParseMetadataSchema
>;

/**
 * The processor's typed return value. Mirrors the shape that the legacy
 * synchronous parse route used to return inline; the contracts package
 * carries the preview-sheet schema, so the result schema here is left
 * permissive and validated at the contract boundary.
 */
export const FileUploadParseResultSchema = z.object({
  uploadSessionId: z.string(),
  sheets: z.array(z.unknown()),
  sliced: z.boolean().optional(),
});
export type FileUploadParseResult = z.infer<
  typeof FileUploadParseResultSchema
>;

/**
 * layout_plan_commit — runs the layout-plan commit pipeline (replay +
 * drift gate + entity_records writes) off the request thread. Both
 * HTTP commit endpoints (`POST /api/layout-plans/commit` for draft
 * commit, `POST /api/connector-instances/:id/layout-plan/:planId/commit`
 * for recommit) enqueue this job and return 202 with `{ jobId, … }`;
 * the frontend awaits the terminal payload via
 * `/api/sse/jobs/:id/events`.
 *
 * Metadata is a discriminated union keyed by `kind`:
 *   - `draft`    — route mints fresh `connectorInstanceId` + `planId`;
 *                  the worker creates the instance row (when not
 *                  `isExistingInstance`) and the plan row inside the
 *                  same write path that produces the records, so a
 *                  failure leaves no orphan rows.
 *   - `recommit` — instance + plan already exist; worker only writes
 *                  records.
 *
 * `plan` is left as `z.unknown()` here to avoid importing
 * `LayoutPlanSchema` from `contracts/` (which would close a model →
 * contract → model cycle); the route validates it against
 * `LayoutPlanSchema` before enqueueing.
 *
 * `workbookSource` references the chunked workbook cache by either
 * upload-session id (file-upload pipeline) or connector-instance id
 * (gsheets / microsoft-excel oauth pipelines). The full workbook is
 * never serialized into job metadata — it lives in Redis via
 * `WorkbookCacheService`.
 */
export const LayoutPlanCommitWorkbookSourceSchema = z.discriminatedUnion(
  "kind",
  [
    z.object({
      kind: z.literal("uploadSession"),
      uploadSessionId: z.string().min(1),
    }),
    z.object({
      kind: z.literal("connectorInstance"),
      connectorInstanceId: z.string().min(1),
    }),
  ]
);
export type LayoutPlanCommitWorkbookSource = z.infer<
  typeof LayoutPlanCommitWorkbookSourceSchema
>;

export const LayoutPlanCommitMetadataSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("draft"),
    organizationId: z.string().min(1),
    userId: z.string().min(1),
    connectorInstanceId: z.string().min(1),
    planId: z.string().min(1),
    connectorDefinitionId: z.string().min(1),
    name: z.string().min(1),
    isExistingInstance: z.boolean(),
    plan: z.unknown(),
    workbookSource: LayoutPlanCommitWorkbookSourceSchema,
  }),
  z.object({
    kind: z.literal("recommit"),
    organizationId: z.string().min(1),
    userId: z.string().min(1),
    connectorInstanceId: z.string().min(1),
    planId: z.string().min(1),
    workbookSource: LayoutPlanCommitWorkbookSourceSchema,
  }),
]);
export type LayoutPlanCommitMetadata = z.infer<
  typeof LayoutPlanCommitMetadataSchema
>;

/**
 * Terminal payload published by the layout-plan-commit processor.
 * Carries everything either commit endpoint used to return inline so
 * the frontend can finish the workflow once the SSE `update` event
 * lands.
 */
export const LayoutPlanCommitJobResultSchema = z.object({
  connectorInstanceId: z.string().min(1),
  planId: z.string().min(1),
  connectorEntityIds: z.array(z.string().min(1)),
  recordCounts: z.object({
    created: z.number().int().nonnegative(),
    updated: z.number().int().nonnegative(),
    unchanged: z.number().int().nonnegative(),
    invalid: z.number().int().nonnegative(),
  }),
});
export type LayoutPlanCommitJobResult = z.infer<
  typeof LayoutPlanCommitJobResultSchema
>;

/**
 * bulk_transform (#85, #99) — agent-driven bulk write that runs a
 * per-record transformation in batches. Two expression kinds: `sql`
 * (declarative SELECT projection per row) and `tool` (per-record
 * dispatch through a bulkDispatch-able tool).
 *
 * Each job carries `writes: BulkTransformWrite[]` — an explicit mapping
 * from per-record computed values to wide-table columns. A single job
 * can land values into N columns across K target entities. The agent
 * supplies how each value binds via `valueFrom` (five kinds; see below).
 *
 * Locks the union of `writes[].targetConnectorEntityId` (denormalized
 * into `metadata.targetConnectorEntityIds`) while non-terminal (see
 * CLAUDE.md → "Async Job State & Data Locking").
 */

/**
 * `valueFrom` discriminates how each `BulkTransformWrite` resolves its
 * per-record value:
 *
 * - `tool_result` — the entire tool output (whatever its schema yields,
 *   primitive/object/array). For SQL-kind jobs this kind is rejected at
 *   pre-flight (there is no tool result to read).
 * - `tool_path` — a Lodash-style path into the tool output: `a.b[0].c`.
 *   Empty path resolves to the whole result. SQL-kind jobs reject.
 * - `sql_alias` — read the named alias from the SQL projection. Tool-kind
 *   jobs reject (there's no SQL projection).
 * - `source_column` — passthrough the named wide-column from the source
 *   row (always the source row; never a SQL-projected value).
 * - `constant` — the agent supplies a literal value.
 */
export const BulkTransformValueFromSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("tool_result") }),
  z.object({
    kind: z.literal("tool_path"),
    /** Lodash-style path: `a.b[0].c`. Empty string resolves to the
     *  whole tool result — useful for primitive-typed outputs. */
    path: z.string(),
  }),
  z.object({
    kind: z.literal("sql_alias"),
    /** Alias declared in the SQL-kind `expression.value` projection. */
    alias: z.string(),
  }),
  z.object({
    kind: z.literal("source_column"),
    /** Wide-column name on the SOURCE entity. */
    column: z.string(),
  }),
  z.object({
    kind: z.literal("constant"),
    /** Any JSON-serializable value the agent picks. Pre-flight validates
     *  it casts to the target column's pgType. */
    value: z.unknown(),
  }),
]);
export type BulkTransformValueFrom = z.infer<typeof BulkTransformValueFromSchema>;

export const BulkTransformWriteSchema = z.object({
  /** Target entity to write into. The aggregate set is locked while the
   *  job runs; pre-flight rejects unknown columns. */
  targetConnectorEntityId: z.string(),
  /** Wide-column name on the target entity. */
  column: z.string(),
  valueFrom: BulkTransformValueFromSchema,
});
export type BulkTransformWrite = z.infer<typeof BulkTransformWriteSchema>;

export const BulkTransformExpressionSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("sql"),
    /** SELECT projection with `AS aliases`; each write of `kind:
     *  "sql_alias"` references one of those aliases. */
    value: z.string(),
    writes: z.array(BulkTransformWriteSchema).min(1),
  }),
  z.object({
    kind: z.literal("tool"),
    /** Tool name; must be a registered bulkDispatch-able tool. */
    ref: z.string(),
    args: z.record(z.string(), z.unknown()).optional(),
    writes: z.array(BulkTransformWriteSchema).min(1),
  }),
]);
export type BulkTransformExpression = z.infer<
  typeof BulkTransformExpressionSchema
>;

export const BulkTransformMetadataSchema = z.object({
  /** Source entity to scan; read-only during the job, no lock. */
  sourceConnectorEntityId: z.string(),
  /** Denormalized union of `writes[].targetConnectorEntityId`, sorted.
   *  This is what the lock query matches against (`?|` array overlap). */
  targetConnectorEntityIds: z.array(z.string()).min(1),
  expression: BulkTransformExpressionSchema,
  /** Source field used as the upsert key on the target. */
  keyField: z.string(),
  batchSize: z
    .number()
    .int()
    .positive()
    .max(10_000)
    .default(DEFAULT_BULK_BATCH),
  /** Required when the dispatched tool declared `costHint: "expensive"`. */
  acknowledgeCost: z.boolean().optional(),
  /** Optional source-side WHERE fragment (#85 Phase 4 retry-failed-only).
   *  Injected into the cursor's WHERE clause. The fragment is validated
   *  via EXPLAIN at the tool's pre-flight; runtime SQL injection is
   *  bounded by the org-scope guard the processor applies. */
  sourceFilter: z
    .object({
      whereSqlFragment: z.string(),
    })
    .optional(),
});
export type BulkTransformMetadata = z.infer<typeof BulkTransformMetadataSchema>;

export const BulkTransformResultSchema = z.object({
  /** Rows actually written to a target's wide table. */
  recordsProcessed: z.number().int().nonnegative(),
  recordsFailed: z.number().int().nonnegative(),
  durationMs: z.number().int().nonnegative(),
  partialFailures: z
    .array(
      z.object({
        sourceKey: z.string(),
        /** Present for per-write failures (a single target's UPSERT
         *  threw for one record); absent for tool-dispatch failures
         *  (the tool itself threw for the record). */
        targetConnectorEntityId: z.string().optional(),
        column: z.string().optional(),
        /** Per-record error envelope; reuses the universal shape so
         *  the agent and UI consume the same payload. */
        error: ApiErrorSchema,
      })
    )
    .optional(),
  /** Defence-in-depth: wide-columns that were dropped per target
   *  because they disappeared between pre-flight and execution.
   *  Pre-flight rejects unknown columns, so this should only fire
   *  if a schema mutation races a running job. */
  droppedByTarget: z
    .array(
      z.object({
        targetConnectorEntityId: z.string(),
        droppedColumns: z.array(z.string()),
      })
    )
    .optional(),
  /** Aggregate count of records that experienced at least one dropped
   *  write across any target. */
  droppedRecords: z.number().int().nonnegative().optional(),
  /** Count of `partialFailures` entries that were elided from the
   *  array to keep the result row bounded. The processor caps the
   *  array at a fixed size (see `MAX_PARTIAL_FAILURES`); when a
   *  pathological run produces more, the head is kept and the tail
   *  is summarized as a count here. `recordsFailed` always carries
   *  the true total. */
  partialFailuresOmitted: z.number().int().nonnegative().optional(),
});
export type BulkTransformResult = z.infer<typeof BulkTransformResultSchema>;

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
  connector_sync: {
    metadata: ConnectorSyncMetadata;
    result: ConnectorSyncResult;
  };
  file_upload_parse: {
    metadata: FileUploadParseMetadata;
    result: FileUploadParseResult;
  };
  layout_plan_commit: {
    metadata: LayoutPlanCommitMetadata;
    result: LayoutPlanCommitJobResult;
  };
  bulk_transform: {
    metadata: BulkTransformMetadata;
    result: BulkTransformResult;
  };
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
  connector_sync: {
    metadata: ConnectorSyncMetadataSchema,
    result: ConnectorSyncResultSchema,
  },
  file_upload_parse: {
    metadata: FileUploadParseMetadataSchema,
    result: FileUploadParseResultSchema,
  },
  layout_plan_commit: {
    metadata: LayoutPlanCommitMetadataSchema,
    result: LayoutPlanCommitJobResultSchema,
  },
  bulk_transform: {
    metadata: BulkTransformMetadataSchema,
    result: BulkTransformResultSchema,
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

