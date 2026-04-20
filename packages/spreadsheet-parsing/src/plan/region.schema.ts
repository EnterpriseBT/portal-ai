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
});

export type Region = z.infer<typeof RegionSchema>;
