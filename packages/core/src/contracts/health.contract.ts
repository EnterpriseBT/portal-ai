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

/**
 * Readiness probe response payload (`GET /api/health/ready`).
 *
 * Unlike the deps-free liveness check above, readiness reflects whether the
 * server can actually serve traffic — its backing dependencies (DB, Redis)
 * are reachable. `checks` names each dependency so a 503 body says *which*
 * one is down; Kubernetes keys off the status code, humans off `checks`.
 */
export const HealthReadyResponseSchema = z.object({
  ready: z.boolean(),
  checks: z.object({
    db: z.boolean(),
    redis: z.boolean(),
  }),
  timestamp: z.string(),
});

export type HealthReadyResponse = z.infer<typeof HealthReadyResponseSchema>;
