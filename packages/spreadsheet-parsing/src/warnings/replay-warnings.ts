import { z } from "zod";

import { BoundsSchema } from "../plan/region.schema.js";
import type { DriftReport, LayoutPlan } from "../plan/index.js";

/**
 * #1009: what a replay skipped or read blank because the plan no longer fits
 * its workbook, in a typed shape commit and sync carry to the job result.
 * Bounds are 1-based, as stored on the plan.
 */
export const REPLAY_WARNINGS_MAX = 20;

export const ReplayWarningSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("bounds-overflow"),
    regionId: z.string().min(1),
    sheet: z.string().min(1),
    targetEntityDefinitionId: z.string().min(1),
    bounds: BoundsSchema,
    sheetLastRow: z.number().int().min(0),
    sheetLastCol: z.number().int().min(0),
  }),
  z.object({
    kind: z.literal("sheet-missing"),
    regionId: z.string().min(1),
    sheet: z.string().min(1),
    targetEntityDefinitionId: z.string().min(1),
    bounds: BoundsSchema,
  }),
]);
export type ReplayWarning = z.infer<typeof ReplayWarningSchema>;

interface WarningDetails {
  boundsOverflow?: { sheetLastRow: number; sheetLastCol: number };
}

/**
 * The plan's overflowing and orphaned regions, in plan order: the first
 * `REPLAY_WARNINGS_MAX`, with `omitted` counting the rest so the job result
 * can't scale with the plan.
 */
export function summarizeReplayWarnings(
  plan: LayoutPlan,
  drift: DriftReport
): { warnings: ReplayWarning[]; omitted: number } {
  const driftByRegion = new Map(drift.regionDrifts.map((d) => [d.regionId, d]));
  const all: ReplayWarning[] = [];
  for (const region of plan.regions) {
    const regionDrift = driftByRegion.get(region.id);
    if (!regionDrift) continue;
    const base = {
      regionId: region.id,
      sheet: region.sheet,
      targetEntityDefinitionId: region.targetEntityDefinitionId,
      bounds: { ...region.bounds },
    };
    if (regionDrift.kinds.includes("sheet-missing")) {
      all.push({ kind: "sheet-missing", ...base });
      continue;
    }
    const overflow = (regionDrift.details as WarningDetails | undefined)
      ?.boundsOverflow;
    if (regionDrift.kinds.includes("bounds-overflow") && overflow) {
      all.push({
        kind: "bounds-overflow",
        ...base,
        sheetLastRow: overflow.sheetLastRow,
        sheetLastCol: overflow.sheetLastCol,
      });
    }
  }
  return {
    warnings: all.slice(0, REPLAY_WARNINGS_MAX),
    omitted: Math.max(0, all.length - REPLAY_WARNINGS_MAX),
  };
}
