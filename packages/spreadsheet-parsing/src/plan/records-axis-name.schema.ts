import { z } from "zod";

import { AxisNameSourceEnum } from "./enums.js";

export const AxisNameSchema = z.object({
  name: z.string().min(1),
  source: AxisNameSourceEnum,
  confidence: z.number().min(0).max(1).optional(),
});

export type AxisName = z.infer<typeof AxisNameSchema>;
/** Frontend-facing alias — same shape, retained for parity with UI naming. */
export type RecordsAxisName = AxisName;
