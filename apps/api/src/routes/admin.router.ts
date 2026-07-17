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
import { maintenanceQueue } from "../queues/maintenance.queue.js";
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
 * /api/admin/maintenance:
 *   get:
 *     tags:
 *       - Admin
 *     summary: Maintenance-queue status (schedulers + recent runs)
 *     description: Operator visibility into the internal maintenance queue (#179) — registered repeatable-job schedulers and the most recent completed/failed runs, read straight from BullMQ state. The ledger retention purge's run summary ({ purged, batches, cutoff }) appears as a run's returnvalue.
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
