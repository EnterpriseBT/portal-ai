import { z } from "zod";
import { TierPolicySchema } from "../models/tier.model.js";
import { CostHintSchema } from "../models/tool-capability.model.js";

/**
 * Response payload carrying an organization's resolved tier policy.
 */
export const TierPolicyGetResponseSchema = z.object({
  tierPolicy: TierPolicySchema,
});

export type TierPolicyGetResponse = z.infer<typeof TierPolicyGetResponseSchema>;

/**
 * Response payload for `GET /api/organization/usage` (#172): the resolved tier
 * policy plus the current-period usage balance (used + available per cost
 * class). `available` is `null` when the class is unlimited.
 */
export const OrganizationUsageGetResponseSchema = z.object({
  tier: TierPolicySchema,
  usage: z.object({
    periodId: z.string(),
    byClass: z.record(
      CostHintSchema,
      z.object({
        used: z.number().int(),
        available: z.number().int().nullable(),
      })
    ),
  }),
});

export type OrganizationUsageGetResponse = z.infer<
  typeof OrganizationUsageGetResponseSchema
>;
