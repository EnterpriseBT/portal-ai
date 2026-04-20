import { z } from "zod";

export const WorkbookFingerprintSchema = z.object({
  sheetNames: z.array(z.string().min(1)),
  dimensions: z.record(
    z.string(),
    z.object({
      rows: z.number().int().min(0),
      cols: z.number().int().min(0),
    })
  ),
  anchorCells: z.array(
    z.object({
      sheet: z.string().min(1),
      row: z.number().int().min(1),
      col: z.number().int().min(1),
      value: z.string(),
    })
  ),
});

export type WorkbookFingerprint = z.infer<typeof WorkbookFingerprintSchema>;
