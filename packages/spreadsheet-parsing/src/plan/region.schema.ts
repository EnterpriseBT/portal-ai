import { z } from "zod";

import {
  AxisMemberEnum,
  DEFAULT_UNTIL_BLANK_COUNT,
  type AxisMember,
} from "./enums.js";
import { SkipRuleSchema } from "./skip-rule.schema.js";
import { DriftKnobsSchema } from "./drift.schema.js";
import {
  ColumnBindingSchema,
  HeaderStrategySchema,
  IdentityStrategySchema,
} from "./strategies.schema.js";
import { WarningSchema } from "./warning.schema.js";

// ── Terminator ─────────────────────────────────────────────────────────────

export const TerminatorSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("untilBlank"),
    consecutiveBlanks: z
      .number()
      .int()
      .min(1)
      .default(DEFAULT_UNTIL_BLANK_COUNT),
  }),
  z.object({
    kind: z.literal("matchesPattern"),
    pattern: z.string().min(1),
  }),
]);
export type Terminator = z.infer<typeof TerminatorSchema>;

// ── Segment ────────────────────────────────────────────────────────────────

export const SegmentSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("field"),
    positionCount: z.number().int().min(1),
  }),
  z.object({
    kind: z.literal("pivot"),
    id: z.string().min(1),
    axisName: z.string().min(1),
    axisNameSource: z.enum(["user", "ai", "anchor-cell"]),
    positionCount: z.number().int().min(1),
    dynamic: z.object({ terminator: TerminatorSchema }).optional(),
    columnDefinitionId: z.string().min(1).optional(),
  }),
  z.object({
    kind: z.literal("skip"),
    positionCount: z.number().int().min(1),
  }),
]);
export type Segment = z.infer<typeof SegmentSchema>;

// ── Cell-value field (set on pivot-bearing regions) ───────────────────────

export const CellValueFieldSchema = z.object({
  name: z.string().min(1),
  nameSource: z.enum(["user", "ai", "anchor-cell"]),
  columnDefinitionId: z.string().min(1).optional(),
});
export type CellValueField = z.infer<typeof CellValueFieldSchema>;

// ── Region ─────────────────────────────────────────────────────────────────

const BoundsSchema = z
  .object({
    startRow: z.number().int().min(1),
    startCol: z.number().int().min(1),
    endRow: z.number().int().min(1),
    endCol: z.number().int().min(1),
  })
  .refine((b) => b.startRow <= b.endRow, {
    message: "startRow must be ≤ endRow",
    path: ["endRow"],
  })
  .refine((b) => b.startCol <= b.endCol, {
    message: "startCol must be ≤ endCol",
    path: ["endCol"],
  });

const AxisAnchorCellSchema = z.object({
  row: z.number().int().min(1),
  col: z.number().int().min(1),
});

const SegmentsByAxisSchema = z.object({
  row: z.array(SegmentSchema).optional(),
  column: z.array(SegmentSchema).optional(),
});

const HeaderStrategyByAxisSchema = z.object({
  row: HeaderStrategySchema.optional(),
  column: HeaderStrategySchema.optional(),
});

const RegionObjectSchema = z.object({
  id: z.string().min(1),
  sheet: z.string().min(1),
  bounds: BoundsSchema,
  targetEntityDefinitionId: z.string().min(1),
  headerAxes: z.array(AxisMemberEnum).max(2).default([]),
  segmentsByAxis: SegmentsByAxisSchema.optional(),
  cellValueField: CellValueFieldSchema.optional(),
  recordsAxis: AxisMemberEnum.optional(),
  recordAxisTerminator: TerminatorSchema.optional(),
  headerStrategyByAxis: HeaderStrategyByAxisSchema.optional(),
  axisAnchorCell: AxisAnchorCellSchema.optional(),
  columnOverrides: z.record(z.string(), z.string()).optional(),
  identityStrategy: IdentityStrategySchema,
  columnBindings: z.array(ColumnBindingSchema),
  skipRules: z.array(SkipRuleSchema),
  drift: DriftKnobsSchema,
  confidence: z.object({
    region: z.number().min(0).max(1),
    aggregate: z.number().min(0).max(1),
  }),
  warnings: z.array(WarningSchema),
});

function positionSpan(
  bounds: { startRow: number; startCol: number; endRow: number; endCol: number },
  axis: AxisMember
): number {
  return axis === "row"
    ? bounds.endCol - bounds.startCol + 1
    : bounds.endRow - bounds.startRow + 1;
}

function hasPivotSegment(segments: Segment[] | undefined): boolean {
  return (segments ?? []).some((s) => s.kind === "pivot");
}

export const RegionSchema = RegionObjectSchema.superRefine((region, ctx) => {
  // NOTE: per-pivot axis-name requirements are enforced as
  // `SEGMENT_MISSING_AXIS_NAME` blocker warnings in `score-and-warn`,
  // not as Zod errors. The schema admits plans with blocker warnings so
  // interpret() can persist them and the review UI can present them.

  // ── axisAnchorCell must be within bounds ──────────────────────────────
  if (region.axisAnchorCell) {
    const { row, col } = region.axisAnchorCell;
    const { startRow, endRow, startCol, endCol } = region.bounds;
    if (row < startRow || row > endRow || col < startCol || col > endCol) {
      ctx.addIssue({
        code: "custom",
        message: "axisAnchorCell must be within the region's bounds",
        path: ["axisAnchorCell"],
      });
    }
  }

  // ── Refinement 1: headerAxes entries unique ───────────────────────────
  const axisSet = new Set(region.headerAxes);
  if (axisSet.size !== region.headerAxes.length) {
    ctx.addIssue({
      code: "custom",
      message: "headerAxes entries must be unique",
      path: ["headerAxes"],
    });
  }

  // ── Refinement 2: segmentsByAxis[axis] only when axis ∈ headerAxes ────
  const declaredAxes = new Set<AxisMember>(region.headerAxes);
  for (const axis of ["row", "column"] as const) {
    const segs = region.segmentsByAxis?.[axis];
    if (segs && !declaredAxes.has(axis)) {
      ctx.addIssue({
        code: "custom",
        message: `segmentsByAxis.${axis} is only allowed when "${axis}" ∈ headerAxes`,
        path: ["segmentsByAxis", axis],
      });
    }
    if (declaredAxes.has(axis) && (!segs || segs.length === 0)) {
      ctx.addIssue({
        code: "custom",
        message: `segmentsByAxis.${axis} is required when "${axis}" ∈ headerAxes`,
        path: ["segmentsByAxis", axis],
      });
    }
  }

  // ── Refinement 3: segmentsByAxis length match per axis ────────────────
  for (const axis of ["row", "column"] as const) {
    const segs = region.segmentsByAxis?.[axis];
    if (!segs || segs.length === 0) continue;
    const span = positionSpan(region.bounds, axis);
    const sum = segs.reduce((acc, s) => acc + s.positionCount, 0);
    const dynamicTail =
      segs.length > 0 && segs[segs.length - 1].kind === "pivot"
        ? (segs[segs.length - 1] as Extract<Segment, { kind: "pivot" }>).dynamic
        : undefined;
    if (dynamicTail) {
      // fixed + dynamicFloor ≤ span, with tail claiming ≥ 1 position.
      if (sum > span) {
        ctx.addIssue({
          code: "custom",
          message: `segmentsByAxis.${axis} positionCount floor ${sum} exceeds span ${span}`,
          path: ["segmentsByAxis", axis],
        });
      }
      const fixedExcludingTail = sum - segs[segs.length - 1].positionCount;
      if (fixedExcludingTail > span - 1) {
        ctx.addIssue({
          code: "custom",
          message: `segmentsByAxis.${axis}: non-tail segments (${fixedExcludingTail}) leave no room for dynamic tail`,
          path: ["segmentsByAxis", axis],
        });
      }
    } else {
      if (sum !== span) {
        ctx.addIssue({
          code: "custom",
          message: `segmentsByAxis.${axis} positionCount sum ${sum} does not match span ${span}`,
          path: ["segmentsByAxis", axis],
        });
      }
    }
  }

  // ── Refinement 4 / 13: pivot id unique across both axes ───────────────
  {
    const seen = new Set<string>();
    for (const axis of ["row", "column"] as const) {
      const segs = region.segmentsByAxis?.[axis] ?? [];
      segs.forEach((s, i) => {
        if (s.kind !== "pivot") return;
        if (seen.has(s.id)) {
          ctx.addIssue({
            code: "custom",
            message: `pivot segment id "${s.id}" is not unique across region segments`,
            path: ["segmentsByAxis", axis, i, "id"],
          });
        }
        seen.add(s.id);
      });
    }
  }

  // ── Refinement 5: recordsAxis required iff headerAxes.length === 0 ────
  if (region.headerAxes.length === 0) {
    if (!region.recordsAxis) {
      ctx.addIssue({
        code: "custom",
        message: "recordsAxis is required when headerAxes is empty",
        path: ["recordsAxis"],
      });
    }
  } else if (region.recordsAxis !== undefined) {
    ctx.addIssue({
      code: "custom",
      message: "recordsAxis is only allowed when headerAxes is empty",
      path: ["recordsAxis"],
    });
  }

  // ── Refinement 6: headerStrategyByAxis[axis] required for every axis ─
  for (const axis of ["row", "column"] as const) {
    const has = region.headerStrategyByAxis?.[axis] !== undefined;
    if (declaredAxes.has(axis) && !has) {
      ctx.addIssue({
        code: "custom",
        message: `headerStrategyByAxis.${axis} is required when "${axis}" ∈ headerAxes`,
        path: ["headerStrategyByAxis", axis],
      });
    }
    if (!declaredAxes.has(axis) && has) {
      ctx.addIssue({
        code: "custom",
        message: `headerStrategyByAxis.${axis} is only allowed when "${axis}" ∈ headerAxes`,
        path: ["headerStrategyByAxis", axis],
      });
    }
  }

  // ── Refinement 7: cellValueField required iff ≥1 pivot segment exists ─
  const anyPivot =
    hasPivotSegment(region.segmentsByAxis?.row) ||
    hasPivotSegment(region.segmentsByAxis?.column);
  if (anyPivot && !region.cellValueField) {
    ctx.addIssue({
      code: "custom",
      message: "cellValueField is required when at least one pivot segment exists",
      path: ["cellValueField"],
    });
  }
  if (!anyPivot && region.cellValueField) {
    ctx.addIssue({
      code: "custom",
      message: "cellValueField is only allowed when a pivot segment exists",
      path: ["cellValueField"],
    });
  }

  // ── Refinement 10: dynamic segment must be tail + at most one per axis ─
  for (const axis of ["row", "column"] as const) {
    const segs = region.segmentsByAxis?.[axis] ?? [];
    let dynamicCount = 0;
    segs.forEach((s, i) => {
      if (s.kind !== "pivot" || !s.dynamic) return;
      dynamicCount++;
      if (i !== segs.length - 1) {
        ctx.addIssue({
          code: "custom",
          message: `dynamic pivot segment must be the last segment on axis "${axis}"`,
          path: ["segmentsByAxis", axis, i, "dynamic"],
        });
      }
    });
    if (dynamicCount > 1) {
      ctx.addIssue({
        code: "custom",
        message: `at most one dynamic pivot segment is allowed per axis`,
        path: ["segmentsByAxis", axis],
      });
    }
  }

  // ── Refinement 11: recordAxisTerminator forbidden on crosstab ─────────
  if (region.headerAxes.length === 2 && region.recordAxisTerminator) {
    ctx.addIssue({
      code: "custom",
      message: "recordAxisTerminator is not allowed on a 2D (crosstab) region",
      path: ["recordAxisTerminator"],
    });
  }

  // ── Refinement 14: locator axis must appear in headerAxes (non-empty) ─
  if (region.headerAxes.length > 0) {
    region.columnBindings.forEach((binding, i) => {
      const locator = binding.sourceLocator;
      if (!declaredAxes.has(locator.axis)) {
        ctx.addIssue({
          code: "custom",
          message: `columnBindings[${i}].sourceLocator.axis "${locator.axis}" is not in headerAxes`,
          path: ["columnBindings", i, "sourceLocator", "axis"],
        });
      }
    });
  }

  // ── Refinement 15: byHeaderName forbidden on headerless regions ───────
  if (region.headerAxes.length === 0) {
    region.columnBindings.forEach((binding, i) => {
      if (binding.sourceLocator.kind === "byHeaderName") {
        ctx.addIssue({
          code: "custom",
          message:
            "byHeaderName bindings are not allowed on headerless regions",
          path: ["columnBindings", i, "sourceLocator", "kind"],
        });
      }
      if (
        binding.sourceLocator.kind === "byPositionIndex" &&
        region.recordsAxis &&
        binding.sourceLocator.axis === region.recordsAxis
      ) {
        ctx.addIssue({
          code: "custom",
          message: `byPositionIndex.axis on a headerless region must be opposite of recordsAxis ("${region.recordsAxis}")`,
          path: ["columnBindings", i, "sourceLocator", "axis"],
        });
      }
    });
  }

  // ── Refinement 16: byPositionIndex.index within position span ─────────
  region.columnBindings.forEach((binding, i) => {
    if (binding.sourceLocator.kind !== "byPositionIndex") return;
    const span = positionSpan(region.bounds, binding.sourceLocator.axis);
    if (binding.sourceLocator.index < 1 || binding.sourceLocator.index > span) {
      ctx.addIssue({
        code: "custom",
        message: `columnBindings[${i}].sourceLocator.index ${binding.sourceLocator.index} out of range [1, ${span}]`,
        path: ["columnBindings", i, "sourceLocator", "index"],
      });
    }
  });
});

export type Region = z.infer<typeof RegionSchema>;

// ── Derived helpers ────────────────────────────────────────────────────────

export function isCrosstab(region: Region): boolean {
  return region.headerAxes.length === 2;
}

export function recordsAxisOf(region: Region): AxisMember | undefined {
  if (region.headerAxes.length === 1) return region.headerAxes[0];
  if (region.headerAxes.length === 0) return region.recordsAxis;
  return undefined;
}

export function isPivoted(region: Region): boolean {
  return (
    hasPivotSegment(region.segmentsByAxis?.row) ||
    hasPivotSegment(region.segmentsByAxis?.column)
  );
}

export function isDynamic(region: Region): boolean {
  if (region.recordAxisTerminator) return true;
  for (const axis of ["row", "column"] as const) {
    const segs = region.segmentsByAxis?.[axis] ?? [];
    if (segs.some((s) => s.kind === "pivot" && s.dynamic)) return true;
  }
  return false;
}
