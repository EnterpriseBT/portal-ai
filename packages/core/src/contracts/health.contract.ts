import { z } from "zod";

/**
 * Health check endpoint response payload.
 */
export const HealthGetResponseSchema = z.object({
  timestamp: z.string(),
  version: z.string(),
  sha: z.string(),
});

export type HealthGetResponse = z.infer<typeof HealthGetResponseSchema>;
