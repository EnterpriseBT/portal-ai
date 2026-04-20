import { z } from "zod";

import { DriftReportSchema } from "./drift.schema.js";

export const ExtractedRecordSchema = z.object({
  regionId: z.string().min(1),
  targetEntityDefinitionId: z.string().min(1),
  sourceId: z.string(),
  checksum: z.string(),
  fields: z.record(z.string(), z.unknown()),
});

export type ExtractedRecord = z.infer<typeof ExtractedRecordSchema>;

export const ReplayResultSchema = z.object({
  records: z.array(ExtractedRecordSchema),
  drift: DriftReportSchema,
});

export type ReplayResult = z.infer<typeof ReplayResultSchema>;
