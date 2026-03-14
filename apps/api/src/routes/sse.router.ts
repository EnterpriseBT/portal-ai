import { Router } from "express";

import { jobEventsRouter } from "./job-events.router.js";

/**
 * Top-level SSE router — aggregates all Server-Sent Event endpoints.
 *
 * Mounted outside the protectedRouter so that query-param auth (sseAuth)
 * can run without being rejected by the router-level jwtCheck which
 * expects an Authorization header that EventSource cannot set.
 */
export const sseRouter = Router();

sseRouter.use("/jobs", jobEventsRouter);
