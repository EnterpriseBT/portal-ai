import { Router, Request, Response, NextFunction } from "express";

import { createLogger } from "../utils/logger.util.js";
import { HttpService, ApiError } from "../services/http.service.js";
import { ApiCode } from "../constants/api-codes.constants.js";
import { DbService } from "../services/db.service.js";
import { JobsService } from "../services/jobs.service.js";
import {
  JobCreateRequestBodySchema,
  JobListRequestQuerySchema,
  type JobCreateResponsePayload,
  type JobGetResponsePayload,
  type JobListResponsePayload,
  type JobCancelResponsePayload,
} from "@portalai/core/contracts";
import { and, Column, eq, ilike, or, sql, SQL } from "drizzle-orm";
import { jobs } from "../db/schema/index.js";
import { getApplicationMetadata } from "../middleware/metadata.middleware.js";

const logger = createLogger({ module: "jobs" });

export const jobsRouter = Router();

const SORTABLE_COLUMNS: Record<string, Column> = {
  created: jobs.created,
  status: jobs.status,
  type: jobs.type,
};

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
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 payload:
 *                   $ref: '#/components/schemas/JobGetResponse'
 *       400:
 *         description: Invalid request body
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ApiErrorResponse'
 *       500:
 *         description: Internal server error
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ApiErrorResponse'
 */
jobsRouter.post(
  "/",
  getApplicationMetadata,
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

      const job = await JobsService.create(
        req.application?.metadata.userId as string,
        parsed.data
      ).catch((error) => {
        if (error instanceof ApiError) throw error;
        throw new ApiError(500, ApiCode.JOB_ENQUEUE_FAILED, error instanceof Error ? error.message : "Failed to create job");
      });

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
      return next(error instanceof ApiError ? error : new ApiError(500, ApiCode.JOB_ENQUEUE_FAILED, error instanceof Error ? error.message : "Failed to create job"));
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
 *       - $ref: '#/components/parameters/sortByParam'
 *       - in: query
 *         name: sortBy
 *         schema:
 *           type: string
 *           enum: [created, status, type]
 *           default: created
 *         description: Field to sort by
 *       - in: query
 *         name: status
 *         schema:
 *           type: string
 *           enum: [pending, active, completed, failed, stalled, cancelled]
 *         description: Filter by job status
 *       - in: query
 *         name: type
 *         schema:
 *           type: string
 *         description: Filter by job type
 *       - in: query
 *         name: search
 *         schema:
 *           type: string
 *         description: Case-insensitive search on job type or error message
 *     responses:
 *       200:
 *         description: Paginated list of jobs
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 payload:
 *                   $ref: '#/components/schemas/JobListResponse'
 *       500:
 *         description: Internal server error
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ApiErrorResponse'
 */
jobsRouter.get(
  "/",
  getApplicationMetadata,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const query = JobListRequestQuerySchema.parse(req.query);
      const filters: SQL[] = [eq(jobs.organizationId, req.application?.metadata.organizationId as string)];

      if (query.status) {
        filters.push(eq(jobs.status, query.status));
      }
      if (query.type) {
        filters.push(eq(jobs.type, query.type));
      }
      if (query.search) {
        filters.push(
          or(
            ilike(sql`${jobs.type}::text`, `%${query.search}%`),
            ilike(jobs.error, `%${query.search}%`)
          )!
        );
      }

      const where = and(...filters);
      const column = SORTABLE_COLUMNS[query.sortBy] ?? SORTABLE_COLUMNS.created;

      const [data, total] = await Promise.all([
        DbService.repository.jobs.findMany(where, {
          limit: query.limit,
          offset: query.offset,
          orderBy: { column, direction: query.sortOrder },
        }),
        DbService.repository.jobs.count(where),
      ]).catch((error) => {
        if (error instanceof ApiError) throw error;
        throw new ApiError(500, ApiCode.JOB_FETCH_FAILED, error instanceof Error ? error.message : "Failed to list jobs");
      });

      const result: JobListResponsePayload = {
        jobs: data,
        total,
        limit: query.limit,
        offset: query.offset,
      };

      return HttpService.success<JobListResponsePayload>(res, result);
    } catch (error) {
      logger.error(
        { error: error instanceof Error ? error.message : "Unknown error" },
        "Failed to list jobs"
      );
      return next(error instanceof ApiError ? error : new ApiError(500, ApiCode.JOB_FETCH_FAILED, error instanceof Error ? error.message : "Failed to list jobs"));
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
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 payload:
 *                   $ref: '#/components/schemas/JobGetResponse'
 *       404:
 *         description: Job not found
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ApiErrorResponse'
 *       500:
 *         description: Internal server error
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ApiErrorResponse'
 */
jobsRouter.get(
  "/:id",
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { id } = req.params;
      logger.info({ id }, "GET /api/jobs/:id called");

      const job = await JobsService.findById(id).catch((error) => {
        if (error instanceof ApiError) throw error;
        throw new ApiError(500, ApiCode.JOB_FETCH_FAILED, error instanceof Error ? error.message : "Failed to fetch job");
      });

      return HttpService.success<JobGetResponsePayload>(res, { job });
    } catch (error) {
      logger.error(
        { error: error instanceof Error ? error.message : "Unknown error" },
        "Failed to fetch job"
      );
      return next(error instanceof ApiError ? error : new ApiError(500, ApiCode.JOB_FETCH_FAILED, error instanceof Error ? error.message : "Failed to fetch job"));
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
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 payload:
 *                   $ref: '#/components/schemas/JobGetResponse'
 *       400:
 *         description: Job already in terminal state
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ApiErrorResponse'
 *       404:
 *         description: Job not found
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ApiErrorResponse'
 *       500:
 *         description: Internal server error
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ApiErrorResponse'
 */
jobsRouter.post(
  "/:id/cancel",
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { id } = req.params;
      logger.info({ id }, "POST /api/jobs/:id/cancel called");

      const job = await JobsService.cancel(id).catch((error) => {
        if (error instanceof ApiError) throw error;
        throw new ApiError(500, ApiCode.JOB_CANCEL_FAILED, error instanceof Error ? error.message : "Failed to cancel job");
      });

      return HttpService.success<JobCancelResponsePayload>(res, { job });
    } catch (error) {
      logger.error(
        { error: error instanceof Error ? error.message : "Unknown error" },
        "Failed to cancel job"
      );
      return next(error instanceof ApiError ? error : new ApiError(500, ApiCode.JOB_CANCEL_FAILED, error instanceof Error ? error.message : "Failed to cancel job"));
    }
  }
);
