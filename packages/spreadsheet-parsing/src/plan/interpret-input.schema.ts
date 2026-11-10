import { z } from "zod";

import { WorkbookSchema } from "../workbook/schema.js";
import { AxisMemberEnum } from "./enums.js";
import { LayoutPlanSchema } from "./layout-plan.schema.js";
import { DriftReportSchema } from "./drift.schema.js";
import {
  CellValueFieldSchema,
  SegmentSchema,
  TerminatorSchema,
} from "./region.schema.js";
import { IdentityStrategySchema } from "./strategies.schema.js";

/**
 * A region hint mirrors the final `Region` shape, but carries only the pieces
 * a caller (UI / auto-detect) can determine upfront. Everything else (header
 * strategy per axis, identity, bindings) is filled in by interpret().
 */
export const RegionHintSchema = z.object({
  sheet: z.string().min(1),
  bounds: z.object({
    startRow: z.number().int().min(1),
    startCol: z.number().int().min(1),
    endRow: z.number().int().min(1),
    endCol: z.number().int().min(1),
  }),
  targetEntityDefinitionId: z.string().min(1),
  headerAxes: z.array(AxisMemberEnum).max(2).default([]),
  segmentsByAxis: z
    .object({
      row: z.array(SegmentSchema).optional(),
      column: z.array(SegmentSchema).optional(),
    })
    .optional(),
  cellValueField: CellValueFieldSchema.optional(),
  /**
   * Per-intersection cell-value overrides on a 2D crosstab hint. Keys are
   * `${rowPivotSegmentId}__${colPivotSegmentId}` referring to pivot
   * segments inside `segmentsByAxis`. Round-trips through interpret so a
   * user's panel edits survive a re-classification.
   */
  intersectionCellValueFields: z
    .record(z.string(), CellValueFieldSchema)
    .optional(),
  recordsAxis: AxisMemberEnum.optional(),
  recordAxisTerminator: TerminatorSchema.optional(),
  axisAnchorCell: z
    .object({
      row: z.number().int().min(1),
      col: z.number().int().min(1),
    })
    .optional(),
  proposedLabel: z.string().optional(),
  /**
   * Pre-seed the region's identity. When omitted, `detectIdentity` runs the
   * uniqueness heuristic. When provided with `source: "user"`, the heuristic
   * is skipped and this strategy is preserved verbatim through interpret.
   * Lets the review-step's identity override survive a re-interpret.
   */
  identityStrategy: IdentityStrategySchema.optional(),
});

export type RegionHint = z.infer<typeof RegionHintSchema>;

export const UserHintsSchema = z.object({
  notes: z.string().optional(),
  columnNicknames: z.record(z.string(), z.string()).optional(),
});

export type UserHints = z.infer<typeof UserHintsSchema>;

export const InterpretInputSchema = z.object({
  workbook: WorkbookSchema,
  regionHints: z.array(RegionHintSchema).optional(),
  priorPlan: LayoutPlanSchema.optional(),
  driftReport: DriftReportSchema.optional(),
  userHints: UserHintsSchema.optional(),
});

export type InterpretInput = z.infer<typeof InterpretInputSchema>;
