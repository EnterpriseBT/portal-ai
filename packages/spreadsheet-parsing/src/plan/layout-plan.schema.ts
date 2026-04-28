import { z } from "zod";

import { RegionSchema } from "./region.schema.js";
import { WorkbookFingerprintSchema } from "./workbook-fingerprint.schema.js";

export const LayoutPlanSchema = z.object({
  planVersion: z.string().min(1),
  workbookFingerprint: WorkbookFingerprintSchema,
  regions: z.array(RegionSchema).min(1),
  confidence: z.object({
    overall: z.number().min(0).max(1),
    perRegion: z.record(z.string(), z.number().min(0).max(1)),
  }),
});

export type LayoutPlan = z.infer<typeof LayoutPlanSchema>;

/**
 * Checkpointed artifacts from `interpret()` — optional per-plan blob that lets
 * the UI inspect stage outputs. The shape intentionally stays permissive; each
 * stage may attach its own slice.
 */
export const InterpretationTraceSchema = z.object({
  stages: z.record(z.string(), z.unknown()),
  modelTokens: z
    .object({
      input: z.number().int().nonnegative(),
      output: z.number().int().nonnegative(),
    })
    .optional(),
});

export type InterpretationTrace = z.infer<typeof InterpretationTraceSchema>;
