/**
 * Admin router — privileged operator endpoints.
 *
 * Mounted under `/api/admin`. Every route requires a Bearer token
 * (enforced by the parent `protectedRouter`'s `jwtCheck`). Endpoints
 * here are intentionally lightweight in capability gating: the
 * operator running them is the same human who deployed the migration.
 */

import { Router, Request, Response, NextFunction } from "express";

import type { MaintenanceStatusResponse } from "@portalai/core/contracts";

import { HttpService, ApiError } from "../services/http.service.js";
import { ApiCode } from "../constants/api-codes.constants.js";
import { getApplicationMetadata } from "../middleware/metadata.middleware.js";
import { wideTableResyncService } from "../services/wide-table-resync.service.js";
import { DissolvePrecomputeService } from "../services/dissolve-precompute.service.js";
import { getMaintenanceQueue } from "../queues/maintenance.queue.js";
import { createLogger } from "../utils/logger.util.js";

const logger = createLogger({ module: "admin" });

export const adminRouter = Router();

/**
 * Trigger a full re-sync after Phase 2's destructive migration.
 *
 * Fans `connector_sync` jobs across every live connector instance,
 * skipping those with an in-flight sync. Returns a structured report
 * with per-instance status so the operator can confirm each adapter
 * picked up. The fan-out itself is fast (just enqueues); per-instance
 * progress is observable via the existing job dashboard / SSE stream.
 */
/**
 * @openapi
 * /api/admin/wide-table/resync:
 *   post:
 *     tags: [Admin]
 *     summary: Fan out a wide-table resync across every connector instance
 *     description: >
 *       Enqueues per-instance resync work and returns immediately with a
 *       per-instance report; progress is observed through the job dashboard /
 *       SSE stream rather than this response.
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Fan-out report
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 triggered: { type: array, items: { type: string } }
 *                 skippedInFlight: { type: array, items: { type: string } }
 *                 skippedUnsupported: { type: array, items: { type: string } }
 *                 failed: { type: array, items: { type: string } }
 *       500:
 *         description: Fan-out failed before any instance was enqueued
 */
adminRouter.post(
  "/wide-table/resync",
  getApplicationMetadata,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const userId = req.application!.metadata.userId;
      const report =
        await wideTableResyncService.resyncAllConnectorInstances(userId);
      logger.info(
        {
          triggered: report.triggered.length,
          skippedInFlight: report.skippedInFlight.length,
          skippedUnsupported: report.skippedUnsupported.length,
          failed: report.failed.length,
          actorUserId: userId,
        },
        "wide_table_resync trigger invoked"
      );
      return HttpService.success(res, report);
    } catch (error) {
      logger.error(
        { error: error instanceof Error ? error.message : "Unknown error" },
        "Failed to run wide-table resync"
      );
      return next(
        error instanceof ApiError
          ? error
          : new ApiError(
              500,
              ApiCode.WIDE_TABLE_RESYNC_FAILED,
              error instanceof Error
                ? error.message
                : "Failed to run wide-table resync"
            )
      );
    }
  }
);

/**
 * @openapi
 * /api/admin/dissolve/reenqueue:
 *   post:
 *     tags: [Admin]
 *     summary: Re-enqueue the polygon dissolve precompute for every dissolvable pin
 *     description: >
 *       Operator-triggered (#541) so bounded merged coverage replaces stale or
 *       degraded rows built by an earlier precompute. Enqueues one
 *       `dissolve_precompute` job per geo pin with a polygon layer; each is
 *       advisory-locked, so an in-flight pin reports `superseded`. Returns
 *       immediately with the count enqueued; progress is observed via the job
 *       dashboard / SSE stream. Not run on boot (that would re-precompute the
 *       whole fleet on every restart).
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Re-enqueue fan-out count
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean, example: true }
 *                 payload:
 *                   type: object
 *                   properties:
 *                     enqueued: { type: integer, example: 12 }
 *       401:
 *         description: Missing authentication
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ApiErrorResponse'
 *       500:
 *         description: Re-enqueue failed before enqueuing
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ApiErrorResponse'
 */
adminRouter.post(
  "/dissolve/reenqueue",
  getApplicationMetadata,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const userId = req.application!.metadata.userId;
      const result =
        await DissolvePrecomputeService.reenqueueAllDissolvable(userId);
      logger.info(
        { enqueued: result.enqueued, actorUserId: userId },
        "dissolve reenqueue trigger invoked (#541)"
      );
      return HttpService.success(res, result);
    } catch (error) {
      logger.error(
        { error: error instanceof Error ? error.message : "Unknown error" },
        "Failed to re-enqueue dissolvable pins"
      );
      return next(
        error instanceof ApiError
          ? error
          : new ApiError(
              500,
              ApiCode.DISSOLVE_REENQUEUE_FAILED,
              error instanceof Error
                ? error.message
                : "Failed to re-enqueue dissolvable pins"
            )
      );
    }
  }
);

/**
 * @openapi
 * /api/admin/maintenance:
 *   get:
 *     tags:
 *       - Admin
 *     summary: Maintenance-queue status (schedulers + recent runs)
 *     description: Operator visibility into the internal maintenance queue (#179) — registered repeatable-job schedulers and the most recent completed/failed runs, read straight from BullMQ state. Each purge's run summary appears as that run's returnvalue — the ledger retention purge reports { purged, batches, cutoff }, and the entity-record retention purge (#442) reports { purgedOrphan, purgedLive, batches, orphanCutoff, liveCutoff }, the two cutoffs naming the windows actually in effect for that run.
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Maintenance status retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 payload:
 *                   $ref: '#/components/schemas/MaintenanceStatusResponse'
 *       401:
 *         description: Missing authentication
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
adminRouter.get(
  "/maintenance",
  getApplicationMetadata,
  async (_req: Request, res: Response, next: NextFunction) => {
    try {
      const maintenanceQueue = getMaintenanceQueue();
      const [schedulers, recentJobs] = await Promise.all([
        maintenanceQueue.getJobSchedulers(),
        // Newest first; bounded so the payload stays small.
        maintenanceQueue.getJobs(["completed", "failed"], 0, 9, false),
      ]);

      const payload: MaintenanceStatusResponse = {
        schedulers: schedulers.map((s) => ({
          id: s.key,
          pattern: s.pattern ?? null,
          next: s.next ?? null,
        })),
        recentRuns: recentJobs.map((job) => ({
          name: job.name,
          finishedOn: job.finishedOn ?? null,
          returnvalue: job.returnvalue ?? null,
          ...(job.failedReason ? { failedReason: job.failedReason } : {}),
        })),
      };

      return HttpService.success<MaintenanceStatusResponse>(res, payload);
    } catch (error) {
      logger.error(
        { error: error instanceof Error ? error.message : "Unknown error" },
        "Failed to read maintenance status"
      );
      return next(
        error instanceof ApiError
          ? error
          : new ApiError(
              500,
              ApiCode.MAINTENANCE_FETCH_FAILED,
              error instanceof Error
                ? error.message
                : "Failed to read maintenance status"
            )
      );
    }
  }
);
