import { z } from "zod";
import { TierPolicySchema } from "../models/tier.model.js";

/**
 * Response payload carrying an organization's resolved tier policy.
 *
 * Slice 3 extends this file with the usage-read payload
 * (`OrganizationUsageGetResponseSchema`) once the `usage` balance exists.
 */
export const TierPolicyGetResponseSchema = z.object({
  tierPolicy: TierPolicySchema,
});

export type TierPolicyGetResponse = z.infer<typeof TierPolicyGetResponseSchema>;
