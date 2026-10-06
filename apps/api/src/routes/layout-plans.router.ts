import { NextFunction, Request, Response, Router } from "express";

import {
  LayoutPlanCommitDraftRequestBodySchema,
  LayoutPlanInterpretDraftRequestBodySchema,
} from "@portalai/core/contracts";
import type {
  LayoutPlanCommitDraftResponsePayload,
  LayoutPlanInterpretDraftResponsePayload,
} from "@portalai/core/contracts";

import { ApiCode } from "../constants/api-codes.constants.js";
import { getApplicationMetadata } from "../middleware/metadata.middleware.js";
import { FileUploadAccessService } from "../services/file-upload-access.service.js";
import { ConnectorInstanceAccessService } from "../services/connector-instance-access.service.js";
import { JobsService } from "../services/jobs.service.js";
import { LayoutPlanDraftService } from "../services/layout-plan-draft.service.js";
import { ApiError, HttpService } from "../services/http.service.js";
import { createLogger } from "../utils/logger.util.js";

const logger = createLogger({ module: "layout-plans" });

export const layoutPlansRouter = Router();

/**
 * #685: a draft's workbook source must be the caller's: their own upload
 * session, or a connector instance they can read (interpret) or write
 * (commit). Org scope alone let a member read or recommit another member's.
 */
async function assertSourceAccessible(
  req: Request,
  body: { uploadSessionId?: string; connectorInstanceId?: string },
  verb: "read" | "write"
): Promise<void> {
  const caller = req.application!.metadata;
  if (body.uploadSessionId) {
    await FileUploadAccessService.assertOwnUploadSession(
      caller,
      body.uploadSessionId
    );
  }
  if (body.connectorInstanceId) {
    await ConnectorInstanceAccessService.load(
      caller,
      body.connectorInstanceId,
      verb
    );
  }
}

/**
 * @openapi
 * /api/layout-plans/interpret:
 *   post:
 *     tags:
 *       - Layout Plans
 *     summary: Interpret a workbook without persisting anything
 *     description: |
 *       Pure-compute endpoint — the server runs `interpret()` against the
 *       submitted workbook and region hints and returns the resulting plan.
 *       No ConnectorInstance is created; no layout-plan row is persisted.
 *       Used by "new connector" flows (FileUploadConnector) that defer
 *       persistence until the user confirms the review step via
 *       `POST /api/layout-plans/commit`.
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/InterpretInput'
 *     responses:
 *       403:
 *         description: The caller lacks permission on this object or it isn't theirs (#685)
 *       200:
 *         description: Interpretation completed
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 payload:
 *                   type: object
 *                   properties:
 *                     plan:
 *                       $ref: '#/components/schemas/LayoutPlan'
 *       400:
 *         description: Invalid request body
 *       500:
 *         description: Interpreter failed
 */
layoutPlansRouter.post(
  "/interpret",
  getApplicationMetadata,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const organizationId = req.application?.metadata.organizationId as string;
      const userId = req.application?.metadata.userId as string;

      const parsed = LayoutPlanInterpretDraftRequestBodySchema.safeParse(
        req.body
      );
      if (!parsed.success) {
        return next(
          new ApiError(
            400,
            ApiCode.LAYOUT_PLAN_INVALID_PAYLOAD,
            "Invalid interpret request body",
            { issues: parsed.error.issues }
          )
        );
      }

      await assertSourceAccessible(req, parsed.data, "read");
      const payload = await LayoutPlanDraftService.interpretDraft(
        organizationId,
        userId,
        parsed.data
      );
      logger.info(
        {
          organizationId,
          regionCount: payload.plan.regions.length,
        },
        "Layout plan interpreted (draft)"
      );
      return HttpService.success<LayoutPlanInterpretDraftResponsePayload>(
        res,
        payload
      );
    } catch (error) {
      logger.error(
        { error: error instanceof Error ? error.message : "Unknown error" },
        "Draft interpret failed"
      );
      return next(
        error instanceof ApiError
          ? error
          : new ApiError(
              500,
              ApiCode.LAYOUT_PLAN_INTERPRET_FAILED,
              error instanceof Error ? error.message : "Interpret failed"
            )
      );
    }
  }
);

/**
 * @openapi
 * /api/layout-plans/commit:
 *   post:
 *     tags:
 *       - Layout Plans
 *     summary: Enqueue draft commit; returns jobId for SSE tracking
 *     description: |
 *       Validates the plan envelope and the workbook source synchronously,
 *       mints fresh `connectorInstanceId` + `planId` UUIDs, and enqueues a
 *       `layout_plan_commit` job. Returns 202 with `{ connectorInstanceId,
 *       planId, jobId, status: "pending" }`; the worker creates the
 *       connector_instance + plan rows and runs the replay + records-write
 *       pipeline off the request thread (~400k-row uploads can otherwise
 *       race the ALB 180 s idle timeout). On any failure past the instance
 *       create, the worker rolls back so the client never sees an orphan
 *       connector. The terminal SSE event carries
 *       `LayoutPlanCommitJobResult` (`@portalai/core/models`).
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/LayoutPlanCommitDraftRequestBody'
 *     responses:
 *       403:
 *         description: The caller can't use the source (upload session or instance), or (new connection) lacks permission to create connector instances (#685, #710)
 *       202:
 *         description: Job enqueued; client tracks completion via SSE.
 *       400:
 *         description: Invalid body
 *       404:
 *         description: connectorDefinitionId or connectorInstanceId not found
 */
layoutPlansRouter.post(
  "/commit",
  getApplicationMetadata,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const organizationId = req.application?.metadata.organizationId as string;
      const userId = req.application?.metadata.userId as string;

      const parsed = LayoutPlanCommitDraftRequestBodySchema.safeParse(req.body);
      if (!parsed.success) {
        return next(
          new ApiError(
            400,
            ApiCode.LAYOUT_PLAN_INVALID_PAYLOAD,
            "Invalid commit request body",
            { issues: parsed.error.issues }
          )
        );
      }

      await assertSourceAccessible(req, parsed.data, "write");
      // #710: without an instance id the commit creates one.
      if (!parsed.data.connectorInstanceId) {
        await ConnectorInstanceAccessService.assertCanCreate(
          req.application!.metadata
        );
      }
      const prepared = await LayoutPlanDraftService.prepareDraftCommit(
        organizationId,
        userId,
        parsed.data
      );
      const job = await JobsService.create(userId, {
        organizationId,
        type: "layout_plan_commit",
        metadata: prepared.metadata,
      });

      logger.info(
        {
          organizationId,
          connectorInstanceId: prepared.connectorInstanceId,
          planId: prepared.planId,
          jobId: job.id,
          isExistingInstance: prepared.metadata.isExistingInstance,
          event: "layout-plan.commit.enqueued",
        },
        "Layout plan commit (draft) enqueued"
      );

      return HttpService.success<LayoutPlanCommitDraftResponsePayload>(
        res,
        {
          connectorInstanceId: prepared.connectorInstanceId,
          planId: prepared.planId,
          jobId: job.id,
          status: "pending",
        },
        202
      );
    } catch (error) {
      logger.error(
        {
          error: error instanceof Error ? error.message : "Unknown error",
          stack: error instanceof Error ? error.stack : undefined,
        },
        "Draft commit enqueue failed"
      );
      return next(
        error instanceof ApiError
          ? error
          : new ApiError(
              500,
              ApiCode.LAYOUT_PLAN_COMMIT_FAILED,
              error instanceof Error ? error.message : "Commit failed"
            )
      );
    }
  }
);
