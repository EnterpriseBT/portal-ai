import { z } from "zod";

/**
 * Health check endpoint response payload.
 */
export const HealthGetResponseSchema = z.object({
  timestamp: z.string(),
});

export type HealthGetResponse = z.infer<typeof HealthGetResponseSchema>;
