import { z } from "zod";

const CellValueSchema = z.union([
  z.string(),
  z.number(),
  z.boolean(),
  z.date(),
  z.null(),
]);

const MergedRangeSchema = z.object({
  startRow: z.number().int().min(1),
  startCol: z.number().int().min(1),
  endRow: z.number().int().min(1),
  endCol: z.number().int().min(1),
});

export const WorkbookCellSchema = z.object({
  row: z.number().int().min(1),
  col: z.number().int().min(1),
  value: CellValueSchema,
  rawText: z.string().optional(),
  merged: MergedRangeSchema.optional(),
});

const SheetDimensionsSchema = z.object({
  rows: z.number().int().min(0),
  cols: z.number().int().min(0),
});

export const SheetDataSchema = z.object({
  name: z.string().min(1),
  dimensions: SheetDimensionsSchema,
  cells: z.array(WorkbookCellSchema),
});

export const WorkbookSchema = z.object({
  sheets: z.array(SheetDataSchema).min(1),
});
