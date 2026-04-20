import { z } from "zod";

import { WorkbookSchema } from "../workbook/schema.js";
import { HeaderAxisEnum, OrientationEnum } from "./enums.js";
import { LayoutPlanSchema } from "./layout-plan.schema.js";
import { DriftReportSchema } from "./drift.schema.js";

export const RegionHintSchema = z.object({
  sheet: z.string().min(1),
  bounds: z.object({
    startRow: z.number().int().min(1),
    startCol: z.number().int().min(1),
    endRow: z.number().int().min(1),
    endCol: z.number().int().min(1),
  }),
  targetEntityDefinitionId: z.string().min(1),
  orientation: OrientationEnum,
  headerAxis: HeaderAxisEnum,
  recordsAxisName: z.string().min(1).optional(),
  secondaryRecordsAxisName: z.string().min(1).optional(),
  cellValueName: z.string().min(1).optional(),
  axisAnchorCell: z
    .object({
      row: z.number().int().min(1),
      col: z.number().int().min(1),
    })
    .optional(),
  proposedLabel: z.string().optional(),
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
