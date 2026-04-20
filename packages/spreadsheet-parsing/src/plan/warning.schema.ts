import { z } from "zod";

import { WarningCodeEnum, WarningSeverityEnum } from "../warnings/codes.js";
import { LocatorSchema } from "./locator.schema.js";

export const WarningSchema = z.object({
  code: WarningCodeEnum,
  severity: WarningSeverityEnum,
  locator: LocatorSchema.optional(),
  message: z.string().min(1),
  suggestedFix: z.string().optional(),
});

export type Warning = z.infer<typeof WarningSchema>;
