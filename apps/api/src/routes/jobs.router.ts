import { Router, Request, Response, NextFunction } from "express";
import { createLogger } from "../utils/logger.util.js";
import { HttpService, ApiError } from "../services/http.service.js";
import { ApiCode } from "../constants/api-codes.constants.js";
import { DbService } from "../services/db.service.js";
import { JobsService } from "../services/jobs.service.js";
import { JobEventsService } from "../services/job-events.service.js";
import { SseUtil } from "../utils/sse.util.js";
import { sseAuth } from "../middleware/sse-auth.middleware.js";
import {
  JobCreateRequestBodySchema,
  JobListRequestQuerySchema,
  type JobCreateResponsePayload,
  type JobGetResponsePayload,
  type JobListResponsePayload,
  type JobCancelResponsePayload,
} from "@mcp-ui/core/contracts";

const logger = createLogger({ module: "jobs" });

export const jobsRouter = Router();

/**
 * @openapi
 * /api/jobs:
 *   post:
 *     tags:
 *       - Jobs
 *     summary: Create and enqueue a new job
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - type
 *               - organizationId
 *             properties:
 *               type:
 *                 type: string
 *               organizationId:
 *                 type: string
 *               metadata:
 *                 type: object
 *     responses:
 *       201:
 *         description: Job created and enqueued
 *       400:
 *         description: Invalid request body
 *       500:
 *         description: Internal server error
 */
jobsRouter.post(
  "/",
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const parsed = JobCreateRequestBodySchema.safeParse(req.body);
      if (!parsed.success) {
        return next(
          new ApiError(
            400,
            ApiCode.JOB_INVALID_PAYLOAD,
            "Invalid job payload"
          )
        );
      }

      const auth0Id = req.auth?.payload.sub as string;
      const user = await DbService.repository.users.findByAuth0Id(auth0Id);
      if (!user) {
        return next(
          new ApiError(404, ApiCode.JOB_USER_NOT_FOUND, "User not found")
        );
      }

      const job = await JobsService.create(user.id, parsed.data);

      logger.info({ jobId: job.id, type: parsed.data.type }, "Job created");

      return HttpService.success<JobCreateResponsePayload>(
        res,
        { job },
        201
      );
    } catch (error) {
      logger.error(
        { error: error instanceof Error ? error.message : "Unknown error" },
        "Failed to create job"
      );

      if (error instanceof ApiError) {
        return next(error);
      }
      return next(
        new ApiError(500, ApiCode.JOB_ENQUEUE_FAILED, "Failed to create job")
      );
    }
  }
);

/**
 * @openapi
 * /api/jobs:
 *   get:
 *     tags:
 *       - Jobs
 *     summary: List jobs for the current organization
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - $ref: '#/components/parameters/limitParam'
 *       - $ref: '#/components/parameters/offsetParam'
 *       - $ref: '#/components/parameters/sortOrderParam'
 *       - in: query
 *         name: sortBy
 *         schema:
 *           type: string
 *           enum: [created, status, type]
 *           default: created
 *       - in: query
 *         name: status
 *         schema:
 *           type: string
 *           enum: [pending, active, completed, failed, stalled, cancelled]
 *       - in: query
 *         name: type
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Paginated list of jobs
 *       500:
 *         description: Internal server error
 */
jobsRouter.get(
  "/",
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const query = JobListRequestQuerySchema.parse(req.query);

      const auth0Id = req.auth?.payload.sub as string;
      const user = await DbService.repository.users.findByAuth0Id(auth0Id);
      if (!user) {
        return next(
          new ApiError(404, ApiCode.JOB_USER_NOT_FOUND, "User not found")
        );
      }

      const result = await JobsService.listForUser(user.id, query);

      return HttpService.success<JobListResponsePayload>(res, result);
    } catch (error) {
      logger.error(
        { error: error instanceof Error ? error.message : "Unknown error" },
        "Failed to list jobs"
      );

      if (error instanceof ApiError) {
        return next(error);
      }
      return next(
        new ApiError(500, ApiCode.JOB_FETCH_FAILED, "Failed to list jobs")
      );
    }
  }
);

/**
 * @openapi
 * /api/jobs/{id}:
 *   get:
 *     tags:
 *       - Jobs
 *     summary: Get a single job by ID
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Job found
 *       404:
 *         description: Job not found
 *       500:
 *         description: Internal server error
 */
jobsRouter.get(
  "/:id",
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { id } = req.params;
      logger.info({ id }, "GET /api/jobs/:id called");

      const job = await JobsService.findById(id);

      return HttpService.success<JobGetResponsePayload>(res, { job });
    } catch (error) {
      logger.error(
        { error: error instanceof Error ? error.message : "Unknown error" },
        "Failed to fetch job"
      );

      if (error instanceof ApiError) {
        return next(error);
      }
      return next(
        new ApiError(500, ApiCode.JOB_FETCH_FAILED, "Failed to fetch job")
      );
    }
  }
);

/**
 * @openapi
 * /api/jobs/{id}/events:
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
jobsRouter.get(
  "/:id/events",
  sseAuth,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const jobId = req.params.id;

      // Verify job exists
      const job = await JobsService.findById(jobId);

      const sse = new SseUtil(res);

      // 1. Send current state snapshot (recovery on reconnect)
      sse.send("snapshot", {
        jobId: job.id,
        status: job.status,
        progress: job.progress,
        error: job.error,
        result: job.result,
        startedAt: job.startedAt,
        completedAt: job.completedAt,
      });

      // 2. If job is already terminal, close immediately
      if (["completed", "failed", "cancelled"].includes(job.status)) {
        sse.end();
        return;
      }

      // 3. Subscribe to live updates via Redis Pub/Sub
      const unsubscribe = JobEventsService.subscribe(jobId, (event) => {
        sse.send("update", event);

        // Close stream when job reaches terminal state
        if (["completed", "failed", "cancelled"].includes(event.status)) {
          unsubscribe();
          sse.end();
        }
      });

      // 4. Cleanup on client disconnect
      req.on("close", () => {
        unsubscribe();
      });
    } catch (error) {
      logger.error(
        { error: error instanceof Error ? error.message : "Unknown error" },
        "Failed to open SSE stream"
      );

      if (error instanceof ApiError) {
        return next(error);
      }
      return next(
        new ApiError(500, ApiCode.JOB_FETCH_FAILED, "Failed to open job event stream")
      );
    }
  }
);

/**
 * @openapi
 * /api/jobs/{id}/cancel:
 *   post:
 *     tags:
 *       - Jobs
 *     summary: Cancel a running or pending job
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Job cancelled
 *       400:
 *         description: Job already in terminal state
 *       404:
 *         description: Job not found
 *       500:
 *         description: Internal server error
 */
jobsRouter.post(
  "/:id/cancel",
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { id } = req.params;
      logger.info({ id }, "POST /api/jobs/:id/cancel called");

      const job = await JobsService.cancel(id);

      return HttpService.success<JobCancelResponsePayload>(res, { job });
    } catch (error) {
      logger.error(
        { error: error instanceof Error ? error.message : "Unknown error" },
        "Failed to cancel job"
      );

      if (error instanceof ApiError) {
        return next(error);
      }
      return next(
        new ApiError(500, ApiCode.JOB_CANCEL_FAILED, "Failed to cancel job")
      );
    }
  }
);
