import { z } from "zod";

export const CellLocatorSchema = z.object({
  kind: z.literal("cell"),
  sheet: z.string().min(1),
  row: z.number().int().min(1),
  col: z.number().int().min(1),
});

export const RangeLocatorSchema = z.object({
  kind: z.literal("range"),
  sheet: z.string().min(1),
  startRow: z.number().int().min(1),
  startCol: z.number().int().min(1),
  endRow: z.number().int().min(1),
  endCol: z.number().int().min(1),
});

export const ColumnLocatorSchema = z.object({
  kind: z.literal("column"),
  sheet: z.string().min(1),
  col: z.number().int().min(1),
});

export const RowLocatorSchema = z.object({
  kind: z.literal("row"),
  sheet: z.string().min(1),
  row: z.number().int().min(1),
});

export const LocatorSchema = z.discriminatedUnion("kind", [
  CellLocatorSchema,
  RangeLocatorSchema,
  ColumnLocatorSchema,
  RowLocatorSchema,
]);

export type Locator = z.infer<typeof LocatorSchema>;
