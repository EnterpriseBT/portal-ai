import { Router, Request, Response, NextFunction } from "express";

import { createLogger } from "../utils/logger.util.js";
import { ApiError } from "../services/http.service.js";
import { ApiCode } from "../constants/api-codes.constants.js";
import { JobsService } from "../services/jobs.service.js";
import { JobEventsService } from "../services/job-events.service.js";
import { SseUtil } from "../utils/sse.util.js";
import { sseAuth } from "../middleware/sse-auth.middleware.js";
import { JobModel } from "@portalai/core/models";
import type { JobSnapshotEvent } from "@portalai/core/contracts";

const logger = createLogger({ module: "job-events" });

/**
 * SSE router for job events — uses query-param auth instead of the
 * Authorization header. Mounted outside the protectedRouter so the
 * router-level jwtCheck does not reject the request before sseAuth runs.
 */
export const jobEventsRouter = Router();

/**
 * @openapi
 * /api/sse/jobs/{id}/events:
 *   get:
 *     tags:
 *       - Jobs
 *     summary: SSE stream for real-time job updates
 *     description: >
 *       Opens a Server-Sent Events stream. On connect, sends a "snapshot"
 *       event with the current job state. Subsequent "update" events are
 *       pushed as the job progresses. The stream closes when the job
 *       reaches a terminal state. Auth via ?token=<jwt> query parameter.
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *       - in: query
 *         name: token
 *         required: true
 *         schema:
 *           type: string
 *         description: JWT token for SSE authentication
 *     responses:
 *       200:
 *         description: SSE event stream
 *       401:
 *         description: Missing or invalid token
 *       404:
 *         description: Job not found
 */
jobEventsRouter.get(
  "/:id/events",
  sseAuth,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const jobId = req.params.id;

      // Verify job exists
      const job = await JobsService.findById(jobId).catch((error) => {
        if (error instanceof ApiError) throw error;
        throw new ApiError(500, ApiCode.JOB_FETCH_FAILED, error instanceof Error ? error.message : "Failed to fetch job for event stream");
      });

      const sse = new SseUtil(res);

      // 1. Send current state snapshot (recovery on reconnect)
      const snapshot: JobSnapshotEvent = {
        jobId: job.id,
        status: job.status,
        progress: job.progress,
        error: job.error,
        result: job.result as Record<string, unknown> | null,
        startedAt: job.startedAt,
        completedAt: job.completedAt,
      };
      sse.send("snapshot", snapshot);

      // 2. If job is already terminal, close immediately
      if (JobModel.isTerminalStatus(job.status)) {
        sse.end();
        return;
      }

      // 3. Subscribe to live updates via Redis Pub/Sub
      let cleaned = false;
      const unsubscribe = JobEventsService.subscribe(jobId, (event) => {
        sse.send("update", event);

        // Close stream when job reaches terminal state
        if (JobModel.isTerminalStatus(event.status) && !cleaned) {
          cleaned = true;
          unsubscribe();
          sse.end();
        }
      });

      // 4. Cleanup on client disconnect
      req.on("close", () => {
        if (!cleaned) {
          cleaned = true;
          unsubscribe();
        }
      });
    } catch (error) {
      logger.error(
        { error: error instanceof Error ? error.message : "Unknown error" },
        "Failed to open SSE stream"
      );
      return next(error instanceof ApiError ? error : new ApiError(500, ApiCode.JOB_SUBSCRIBE_FAILED, error instanceof Error ? error.message : "Failed to open job event stream"));
    }
  }
);
