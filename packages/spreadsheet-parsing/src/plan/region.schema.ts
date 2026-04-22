import { z } from "zod";

import { BoundsModeEnum, HeaderAxisEnum, OrientationEnum } from "./enums.js";
import { AxisNameSchema } from "./records-axis-name.schema.js";
import { SkipRuleSchema } from "./skip-rule.schema.js";
import { DriftKnobsSchema } from "./drift.schema.js";
import {
  ColumnBindingSchema,
  HeaderStrategySchema,
  IdentityStrategySchema,
} from "./strategies.schema.js";
import { WarningSchema } from "./warning.schema.js";

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

export const AxisPositionRoleSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("field") }),
  z.object({
    kind: z.literal("pivotLabel"),
    segmentId: z.string().min(1),
  }),
  z.object({ kind: z.literal("skip") }),
]);
export type AxisPositionRole = z.infer<typeof AxisPositionRoleSchema>;

export const PivotSegmentSchema = z.object({
  id: z.string().min(1),
  axisName: z.string().min(1),
  axisNameSource: z.enum(["user", "ai", "anchor-cell"]),
  valueFieldName: z.string().min(1),
  valueFieldNameSource: z.enum(["user", "ai", "anchor-cell"]),
  valueColumnDefinitionId: z.string().min(1).optional(),
});
export type PivotSegment = z.infer<typeof PivotSegmentSchema>;

const RegionObjectSchema = z.object({
  id: z.string().min(1),
  sheet: z.string().min(1),
  bounds: BoundsSchema,
  boundsMode: BoundsModeEnum.default("absolute"),
  boundsPattern: z.string().optional(),
  untilEmptyTerminatorCount: z.number().int().min(1).optional(),
  targetEntityDefinitionId: z.string().min(1),
  orientation: OrientationEnum,
  headerAxis: HeaderAxisEnum,
  recordsAxisName: AxisNameSchema.optional(),
  secondaryRecordsAxisName: AxisNameSchema.optional(),
  cellValueName: AxisNameSchema.optional(),
  columnOverrides: z.record(z.string(), z.string()).optional(),
  axisAnchorCell: AxisAnchorCellSchema.optional(),
  headerStrategy: HeaderStrategySchema.optional(),
  identityStrategy: IdentityStrategySchema,
  columnBindings: z.array(ColumnBindingSchema),
  skipRules: z.array(SkipRuleSchema),
  drift: DriftKnobsSchema,
  confidence: z.object({
    region: z.number().min(0).max(1),
    aggregate: z.number().min(0).max(1),
  }),
  warnings: z.array(WarningSchema),
  positionRoles: z.array(AxisPositionRoleSchema).optional(),
  pivotSegments: z.array(PivotSegmentSchema).optional(),
});

export const RegionSchema = RegionObjectSchema.superRefine((region, ctx) => {
  // NOTE: pivoted / crosstab axis-name requirements are enforced as
  // `PIVOTED_REGION_MISSING_AXIS_NAME` *blocker warnings* (see `score-and-warn`),
  // not as Zod errors. The schema must admit plans that still have blocker
  // warnings attached so `interpret()` can persist them and the review UI can
  // present them for correction before commit.

  // ── boundsMode === "matchesPattern" requires boundsPattern ────────────
  if (region.boundsMode === "matchesPattern" && !region.boundsPattern?.trim()) {
    ctx.addIssue({
      code: "custom",
      message: "boundsPattern is required when boundsMode === 'matchesPattern'",
      path: ["boundsPattern"],
    });
  }

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

  // ── headerAxis "none" forbids byHeaderName bindings ───────────────────
  if (region.headerAxis === "none") {
    region.columnBindings.forEach((binding, i) => {
      if (binding.sourceLocator.kind === "byHeaderName") {
        ctx.addIssue({
          code: "custom",
          message:
            "headerAxis 'none' requires byColumnIndex bindings; byHeaderName is not allowed",
          path: ["columnBindings", i, "sourceLocator", "kind"],
        });
      }
    });
  }

  // ── headerAxis "row" or "column" needs a headerStrategy ───────────────
  if (region.headerAxis !== "none" && !region.headerStrategy) {
    ctx.addIssue({
      code: "custom",
      message: "headerStrategy is required when headerAxis is not 'none'",
      path: ["headerStrategy"],
    });
  }

  // ── Segmentation refinements ──────────────────────────────────────────
  // Crosstab exemption: `cells-as-records` does not support segmentation in
  // v1 (see docs/REGION_CONFIG.schema_replay.spec.md). Segmented crosstab
  // stays deferred to v2 — Zod rejects here so a malformed plan can't slip
  // past earlier pipeline stages that do not yet understand segmentation.
  if (
    region.orientation === "cells-as-records" &&
    ((region.positionRoles?.length ?? 0) > 0 ||
      (region.pivotSegments?.length ?? 0) > 0)
  ) {
    ctx.addIssue({
      code: "custom",
      message: "SEGMENTED_CROSSTAB_NOT_SUPPORTED",
      path: ["positionRoles"],
    });
  }

  // positionRoles length must match the header-line length so every
  // position has exactly one role.
  if (region.positionRoles && region.headerAxis !== "none") {
    const expected =
      region.headerAxis === "row"
        ? region.bounds.endCol - region.bounds.startCol + 1
        : region.bounds.endRow - region.bounds.startRow + 1;
    if (region.positionRoles.length !== expected) {
      ctx.addIssue({
        code: "custom",
        message: `positionRoles length ${region.positionRoles.length} does not match header-line length ${expected}`,
        path: ["positionRoles"],
      });
    }
  }

  // Every pivotLabel.segmentId must resolve to a declared pivotSegment,
  // and every pivotSegment must be referenced by at least one position.
  if (region.positionRoles && region.pivotSegments) {
    const declared = new Set(region.pivotSegments.map((s) => s.id));
    const referenced = new Set<string>();
    region.positionRoles.forEach((role, i) => {
      if (role.kind !== "pivotLabel") return;
      referenced.add(role.segmentId);
      if (!declared.has(role.segmentId)) {
        ctx.addIssue({
          code: "custom",
          message: `positionRoles[${i}].segmentId "${role.segmentId}" is not declared in pivotSegments`,
          path: ["positionRoles", i, "segmentId"],
        });
      }
    });
    region.pivotSegments.forEach((segment, i) => {
      if (!referenced.has(segment.id)) {
        ctx.addIssue({
          code: "custom",
          message: `pivotSegments[${i}].id "${segment.id}" is not referenced by any position`,
          path: ["pivotSegments", i, "id"],
        });
      }
    });
  }
});

export type Region = z.infer<typeof RegionSchema>;
