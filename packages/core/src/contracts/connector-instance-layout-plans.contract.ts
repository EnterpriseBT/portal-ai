import { z } from "zod";

import { FileUploadParseSheetSchema } from "./file-uploads.contract.js";
import {
  InterpretationTraceSchema,
  InterpretInputSchema,
  LayoutPlanSchema,
} from "./spreadsheet-parsing.contract.js";

// ── Request schemas ───────────────────────────────────────────────────────

/**
 * Body for `POST /api/connector-instances/:id/layout-plan/interpret`.
 *
 * Mirrors the parser module's `InterpretInputSchema` — workbook passed inline
 * for v1. A future Phase 8 revision may add an S3-key alternative so large
 * workbooks don't inflate request payloads.
 */
export const InterpretRequestBodySchema = InterpretInputSchema;
export type InterpretRequestBody = z.infer<typeof InterpretRequestBodySchema>;

/**
 * Body for `PATCH /api/connector-instances/:id/layout-plan/:planId`.
 *
 * Freeform object — the service merges it onto the current plan then revalidates
 * the merged result with `LayoutPlanSchema`. Using a permissive shape here lets
 * the UI submit partial edits (single region, single binding) without
 * reconstructing the full plan envelope.
 */
export const PatchLayoutPlanBodySchema = z.record(z.string(), z.unknown());
export type PatchLayoutPlanBody = z.infer<typeof PatchLayoutPlanBodySchema>;

// ── Response schemas ──────────────────────────────────────────────────────

/**
 * Response payload for the interpret endpoint — returns the persisted plan's
 * database id (required for a follow-on commit), the plan itself, and the
 * checkpointed interpretation trace for UI inspection.
 */
export const InterpretResponsePayloadSchema = z.object({
  planId: z.string().min(1),
  plan: LayoutPlanSchema,
  interpretationTrace: InterpretationTraceSchema.nullable(),
});
export type InterpretResponsePayload = z.infer<
  typeof InterpretResponsePayloadSchema
>;

/**
 * Response payload for `GET /api/connector-instances/:id/layout-plan`.
 * `interpretationTrace` is nullable + only included when the caller opts in via
 * `?include=interpretationTrace` (the router strips it otherwise).
 */
export const LayoutPlanResponsePayloadSchema = z.object({
  planId: z.string().min(1),
  plan: LayoutPlanSchema,
  interpretationTrace: InterpretationTraceSchema.nullable(),
});
export type LayoutPlanResponsePayload = z.infer<
  typeof LayoutPlanResponsePayloadSchema
>;

// ── Commit ────────────────────────────────────────────────────────────────

/**
 * Body for `POST /api/connector-instances/:id/layout-plan/:planId/commit`.
 *
 * References the workbook by its chunked-cache source rather than
 * accepting it inline — large uploads (~100 MB+ / hundreds of
 * thousands of rows) won't fit in the job metadata that backs the
 * async commit pipeline, and the cache lookup is what every other
 * commit/sync path already does.
 *
 * Exactly one of:
 *   - `uploadSessionId` — file-upload pipeline. Server reads from
 *     `WorkbookCacheService` under `upload-session:{id}`.
 *   - `connectorInstanceId` — OAuth-driven spreadsheet pipelines
 *     (google-sheets, microsoft-excel) that already own a populated
 *     instance cache under `connector:wb:<slug>:{id}`.
 */
export const CommitLayoutPlanRequestBodySchema = z
  .object({
    uploadSessionId: z.string().min(1).optional(),
    connectorInstanceId: z.string().min(1).optional(),
  })
  .refine(
    (v) =>
      (v.uploadSessionId && !v.connectorInstanceId) ||
      (!v.uploadSessionId && v.connectorInstanceId),
    {
      message:
        "Exactly one of `uploadSessionId` or `connectorInstanceId` must be provided",
      path: ["uploadSessionId"],
    }
  );
export type CommitLayoutPlanRequestBody = z.infer<
  typeof CommitLayoutPlanRequestBodySchema
>;

/**
 * Response from both commit endpoints. The route validates inputs,
 * (for draft commit only) mints fresh `connectorInstanceId` /
 * `planId` UUIDs, enqueues a `layout_plan_commit` job, and returns
 * 202. The terminal payload (`LayoutPlanCommitJobResult` in
 * `@portalai/core/models/job.model.ts`) is delivered through
 * `/api/sse/jobs/:id/events`.
 *
 * For the recommit endpoint the returned `connectorInstanceId` /
 * `planId` echo the path parameters; for the draft commit they are
 * the freshly-minted ids the worker will write under, so the client
 * can navigate to the new connector while the records-write is still
 * in flight.
 */
export const LayoutPlanCommitEnqueuedResponseSchema = z.object({
  connectorInstanceId: z.string().min(1),
  planId: z.string().min(1),
  jobId: z.string().min(1),
  status: z.literal("pending"),
});
export type LayoutPlanCommitEnqueuedResponse = z.infer<
  typeof LayoutPlanCommitEnqueuedResponseSchema
>;

/**
 * Summary returned by a successful commit. `connectorEntityIds` lists every
 * `ConnectorEntity` row upserted (one per distinct `targetEntityDefinitionId`).
 * `recordCounts` mirrors the legacy `record-import.util.ts` counters so
 * consumers have a single summary shape across legacy and plan-driven paths.
 */
export const LayoutPlanCommitResultSchema = z.object({
  connectorEntityIds: z.array(z.string().min(1)),
  recordCounts: z.object({
    created: z.number().int().min(0),
    updated: z.number().int().min(0),
    unchanged: z.number().int().min(0),
    invalid: z.number().int().min(0),
  }),
});
export type LayoutPlanCommitResult = z.infer<
  typeof LayoutPlanCommitResultSchema
>;

// ── Instance-less draft flow ───────────────────────────────────────────────
// FileUpload and other "new connector" workflows defer ConnectorInstance
// creation until the user confirms the review step. The server-side interpret
// becomes pure-compute; commit creates the ConnectorInstance + layout plan
// row + records atomically, with rollback on failure.

/**
 * Body for `POST /api/layout-plans/interpret`. Pure-compute: the server runs
 * `interpret()` and returns the resulting plan without any DB writes.
 *
 * Workbook source — exactly one of:
 *   - `uploadSessionId` — file-upload pipeline. Server reads from
 *     `WorkbookCacheService` under `upload-session:{id}` (or re-streams
 *     from S3 on cache miss).
 *   - `connectorInstanceId` — OAuth-driven spreadsheet pipelines (e.g.
 *     google-sheets, microsoft-excel) that already own a pending
 *     instance. Server reads from the connector workbook cache under
 *     `connector:wb:<slug>:{id}`.
 */
export const LayoutPlanInterpretDraftRequestBodySchema = z
  .object({
    uploadSessionId: z.string().min(1).optional(),
    connectorInstanceId: z.string().min(1).optional(),
    regionHints: InterpretInputSchema.shape.regionHints,
    priorPlan: InterpretInputSchema.shape.priorPlan,
    driftReport: InterpretInputSchema.shape.driftReport,
    userHints: InterpretInputSchema.shape.userHints,
  })
  .refine(
    (v) =>
      (v.uploadSessionId && !v.connectorInstanceId) ||
      (!v.uploadSessionId && v.connectorInstanceId),
    {
      message:
        "Exactly one of `uploadSessionId` or `connectorInstanceId` must be provided",
      path: ["uploadSessionId"],
    }
  );
export type LayoutPlanInterpretDraftRequestBody = z.infer<
  typeof LayoutPlanInterpretDraftRequestBodySchema
>;

export const LayoutPlanInterpretDraftResponsePayloadSchema = z.object({
  plan: LayoutPlanSchema,
});
export type LayoutPlanInterpretDraftResponsePayload = z.infer<
  typeof LayoutPlanInterpretDraftResponsePayloadSchema
>;

/**
 * Body for `POST /api/layout-plans/commit`. Creates the ConnectorInstance +
 * layout plan row + records in one server-side call. On any failure, the
 * instance and plan row are rolled back so no orphan survives.
 */
/**
 * Body for `POST /api/layout-plans/commit`.
 *
 * Two paths, discriminated by which session id is present:
 *
 * **uploadSessionId path (file-upload):** server CREATES a fresh
 * ConnectorInstance with the supplied `connectorDefinitionId` + `name`,
 * runs the commit pipeline, and on failure rolls back the instance +
 * plan row.
 *
 * **connectorInstanceId path (google-sheets et al.):** server uses the
 * EXISTING pending ConnectorInstance (created earlier by the OAuth
 * callback). Commit flips its status from "pending" → "active". The
 * `connectorDefinitionId` and `name` fields are still required and used
 * as-is — the server does not validate them against the existing
 * instance for this path; the frontend is expected to pass values that
 * match. The file_uploads-committed bookkeeping step is skipped.
 */
export const LayoutPlanCommitDraftRequestBodySchema = z
  .object({
    connectorDefinitionId: z.string().min(1),
    name: z.string().min(1),
    plan: LayoutPlanSchema,
    uploadSessionId: z.string().min(1).optional(),
    connectorInstanceId: z.string().min(1).optional(),
  })
  .refine(
    (v) =>
      (v.uploadSessionId && !v.connectorInstanceId) ||
      (!v.uploadSessionId && v.connectorInstanceId),
    {
      message:
        "Exactly one of `uploadSessionId` or `connectorInstanceId` must be provided",
      path: ["uploadSessionId"],
    }
  );
export type LayoutPlanCommitDraftRequestBody = z.infer<
  typeof LayoutPlanCommitDraftRequestBodySchema
>;

/**
 * Synchronous response shape for `POST /api/layout-plans/commit` is
 * now the shared `LayoutPlanCommitEnqueuedResponseSchema` — the route
 * returns 202 + jobId and the records-write happens off the request
 * thread. `recordCounts` arrives later as the job's terminal SSE
 * payload (`LayoutPlanCommitJobResult` in `@portalai/core/models`).
 */
export const LayoutPlanCommitDraftResponsePayloadSchema =
  LayoutPlanCommitEnqueuedResponseSchema;
export type LayoutPlanCommitDraftResponsePayload = z.infer<
  typeof LayoutPlanCommitDraftResponsePayloadSchema
>;

// ── Edit context (GET .../layout-plan/edit-context) ───────────────────────

/**
 * Preview-shape workbook bundled with the edit context. Same envelope the
 * file-upload `parse` and connector `select-sheet` responses use today — the
 * region editor already knows how to render it. `cells: []` for sheets over
 * `FILE_UPLOAD_INLINE_CELLS_MAX`; the editor falls back to per-rectangle
 * slice requests against the matching connector's `sheetSlice` endpoint.
 */
export const LayoutPlanEditContextWorkbookPreviewSchema = z.object({
  sheets: z.array(FileUploadParseSheetSchema),
  sliced: z.boolean().optional(),
});
export type LayoutPlanEditContextWorkbookPreview = z.infer<
  typeof LayoutPlanEditContextWorkbookPreviewSchema
>;

/**
 * Response payload for
 * `GET /api/connector-instances/:connectorInstanceId/layout-plan/edit-context`.
 *
 * Bundles everything the edit view needs at mount time into one round-trip:
 * the current plan + id, the connector slug (for slice-dispatch), and a
 * preview of the workbook. `workbookPreview` is `null` only when the
 * workbook source can no longer be resolved (`editable: false`); in that
 * case `reason` carries a stable code + human message for the UI to surface.
 */
export const LayoutPlanEditContextResponsePayloadSchema = z.object({
  planId: z.string().min(1),
  plan: LayoutPlanSchema,
  connectorDefinitionSlug: z.string().min(1),
  workbookPreview: LayoutPlanEditContextWorkbookPreviewSchema.nullable(),
  editable: z.boolean(),
  reason: z
    .object({
      code: z.string().min(1),
      message: z.string().min(1),
    })
    .optional(),
});
export type LayoutPlanEditContextResponsePayload = z.infer<
  typeof LayoutPlanEditContextResponsePayloadSchema
>;
