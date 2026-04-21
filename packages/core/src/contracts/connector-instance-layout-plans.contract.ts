import { z } from "zod";

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
 * Accepts the workbook inline — the commit service runs `replay(plan,
 * workbook)` and writes the resulting records into `entity_records`. A future
 * revision may accept an S3 key instead for large workbooks.
 */
export const CommitLayoutPlanRequestBodySchema = z.object({
  workbook: z.unknown(),
});
export type CommitLayoutPlanRequestBody = z.infer<
  typeof CommitLayoutPlanRequestBodySchema
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
 * `interpret()` and returns the resulting plan without any DB writes. The
 * workbook is always resolved via the streaming upload session — the server
 * pulls it from Redis, falling back to re-streaming from S3 on cache miss.
 */
export const LayoutPlanInterpretDraftRequestBodySchema = z.object({
  uploadSessionId: z.string().min(1),
  regionHints: InterpretInputSchema.shape.regionHints,
  priorPlan: InterpretInputSchema.shape.priorPlan,
  driftReport: InterpretInputSchema.shape.driftReport,
  userHints: InterpretInputSchema.shape.userHints,
});
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
export const LayoutPlanCommitDraftRequestBodySchema = z.object({
  connectorDefinitionId: z.string().min(1),
  name: z.string().min(1),
  plan: LayoutPlanSchema,
  uploadSessionId: z.string().min(1),
});
export type LayoutPlanCommitDraftRequestBody = z.infer<
  typeof LayoutPlanCommitDraftRequestBodySchema
>;

export const LayoutPlanCommitDraftResponsePayloadSchema = z.object({
  connectorInstanceId: z.string().min(1),
  planId: z.string().min(1),
  recordCounts: LayoutPlanCommitResultSchema.shape.recordCounts,
});
export type LayoutPlanCommitDraftResponsePayload = z.infer<
  typeof LayoutPlanCommitDraftResponsePayloadSchema
>;
