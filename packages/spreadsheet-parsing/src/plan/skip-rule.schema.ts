import { z } from "zod";

import { SkipRuleAxisEnum } from "./enums.js";

const BlankSkipRuleSchema = z.object({ kind: z.literal("blank") });

const CellMatchesSkipRuleSchema = z.object({
  kind: z.literal("cellMatches"),
  /** 0-based absolute sheet index; column for rows-as-records, row for columns-as-records. */
  crossAxisIndex: z.number().int().nonnegative(),
  pattern: z.string().min(1),
  axis: SkipRuleAxisEnum.optional(),
});

export const SkipRuleSchema = z.discriminatedUnion("kind", [
  BlankSkipRuleSchema,
  CellMatchesSkipRuleSchema,
]);

export type SkipRule = z.infer<typeof SkipRuleSchema>;
