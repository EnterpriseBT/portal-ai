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
 * Response payload for the interpret endpoint — returns both the persisted
 * plan and the checkpointed interpretation trace for UI inspection.
 */
export const InterpretResponsePayloadSchema = z.object({
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
