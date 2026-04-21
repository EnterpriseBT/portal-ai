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
import { LayoutPlanDraftService } from "../services/layout-plan-draft.service.js";
import { ApiError, HttpService } from "../services/http.service.js";
import { createLogger } from "../utils/logger.util.js";

const logger = createLogger({ module: "layout-plans" });

export const layoutPlansRouter = Router();

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
 *     summary: Create the ConnectorInstance + layout plan and commit records atomically
 *     description: |
 *       Creates a fresh ConnectorInstance, persists the supplied plan against
 *       it, and runs the replay + record-write pipeline. On any failure past
 *       the instance insert, both rows are rolled back so the client never
 *       sees an orphan connector.
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - connectorDefinitionId
 *               - name
 *               - plan
 *               - workbook
 *             properties:
 *               connectorDefinitionId:
 *                 type: string
 *               name:
 *                 type: string
 *               plan:
 *                 $ref: '#/components/schemas/LayoutPlan'
 *               workbook:
 *                 type: object
 *     responses:
 *       200:
 *         description: Commit succeeded
 *       400:
 *         description: Invalid body
 *       409:
 *         description: Drift or blocker-warnings gate blocked the commit (instance rolled back)
 *       500:
 *         description: Replay or record write failed (instance rolled back)
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

      const payload = await LayoutPlanDraftService.commitDraft(
        organizationId,
        userId,
        parsed.data
      );
      logger.info(
        {
          organizationId,
          connectorInstanceId: payload.connectorInstanceId,
          planId: payload.planId,
          recordCounts: payload.recordCounts,
        },
        "Layout plan committed (draft)"
      );
      return HttpService.success<LayoutPlanCommitDraftResponsePayload>(
        res,
        payload
      );
    } catch (error) {
      logger.error(
        {
          error: error instanceof Error ? error.message : "Unknown error",
          stack: error instanceof Error ? error.stack : undefined,
        },
        "Draft commit failed"
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
