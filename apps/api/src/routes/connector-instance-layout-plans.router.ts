import { NextFunction, Request, Response, Router } from "express";

import {
  CommitLayoutPlanRequestBodySchema,
  InterpretRequestBodySchema,
  PatchLayoutPlanBodySchema,
} from "@portalai/core/contracts";
import type {
  InterpretResponsePayload,
  LayoutPlanCommitResult,
  LayoutPlanResponsePayload,
} from "@portalai/core/contracts";

import { ApiCode } from "../constants/api-codes.constants.js";
import { getApplicationMetadata } from "../middleware/metadata.middleware.js";
import { ConnectorInstanceLayoutPlansService } from "../services/connector-instance-layout-plans.service.js";
import { LayoutPlanCommitService } from "../services/layout-plan-commit.service.js";
import { ApiError, HttpService } from "../services/http.service.js";
import { createLogger } from "../utils/logger.util.js";

const logger = createLogger({ module: "connector-instance-layout-plans" });

export const connectorInstanceLayoutPlansRouter = Router();

/**
 * @openapi
 * /api/connector-instances/{connectorInstanceId}/layout-plan/interpret:
 *   post:
 *     tags:
 *       - Layout Plans
 *     summary: Interpret a workbook and persist a layout plan
 *     description: |
 *       Runs the spreadsheet-parsing module's `interpret()` against the
 *       submitted workbook and region hints. Persists the returned plan
 *       as the new current revision for this connector instance; supersedes
 *       any prior current plan in the same transaction.
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: connectorInstanceId
 *         required: true
 *         schema:
 *           type: string
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/InterpretInput'
 *     responses:
 *       200:
 *         description: Interpretation completed and persisted
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
 *                     interpretationTrace:
 *                       type: object
 *                       nullable: true
 *       400:
 *         description: Invalid request body
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ApiErrorResponse'
 *       401:
 *         description: Missing or invalid bearer token
 *       404:
 *         description: Connector instance not found for this organization
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ApiErrorResponse'
 *       500:
 *         description: Interpret failed
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ApiErrorResponse'
 */
connectorInstanceLayoutPlansRouter.post(
  "/:connectorInstanceId/layout-plan/interpret",
  getApplicationMetadata,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { connectorInstanceId } = req.params;
      const { organizationId, userId } = req.application!.metadata;

      const parsed = InterpretRequestBodySchema.safeParse(req.body);
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

      const payload = await ConnectorInstanceLayoutPlansService.interpret(
        connectorInstanceId,
        organizationId,
        userId,
        parsed.data
      );

      logger.info(
        {
          connectorInstanceId,
          organizationId,
          regionCount: payload.plan.regions.length,
        },
        "Layout plan interpreted and persisted"
      );

      return HttpService.success<InterpretResponsePayload>(res, payload);
    } catch (error) {
      logger.error(
        {
          error: error instanceof Error ? error.message : "Unknown error",
          connectorInstanceId: req.params.connectorInstanceId,
        },
        "Layout plan interpret failed"
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
 * /api/connector-instances/{connectorInstanceId}/layout-plan:
 *   get:
 *     tags:
 *       - Layout Plans
 *     summary: Fetch the current layout plan
 *     description: |
 *       Returns the current (non-superseded, non-deleted) layout plan for the
 *       connector instance. `interpretationTrace` is stripped by default;
 *       pass `?include=interpretationTrace` to retrieve it.
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: connectorInstanceId
 *         required: true
 *         schema:
 *           type: string
 *       - in: query
 *         name: include
 *         required: false
 *         description: Comma-separated list of optional includes. Supports `interpretationTrace`.
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Current plan
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
 *                     interpretationTrace:
 *                       type: object
 *                       nullable: true
 *       404:
 *         description: No plan exists for this connector instance
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ApiErrorResponse'
 */
connectorInstanceLayoutPlansRouter.get(
  "/:connectorInstanceId/layout-plan",
  getApplicationMetadata,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { connectorInstanceId } = req.params;
      const { organizationId } = req.application!.metadata;

      const includeList =
        typeof req.query.include === "string"
          ? req.query.include
              .split(",")
              .map((s) => s.trim())
              .filter(Boolean)
          : [];
      const includeTrace = includeList.includes("interpretationTrace");

      const payload = await ConnectorInstanceLayoutPlansService.getCurrent(
        connectorInstanceId,
        organizationId,
        { includeTrace }
      );
      return HttpService.success<LayoutPlanResponsePayload>(res, payload);
    } catch (error) {
      logger.error(
        {
          error: error instanceof Error ? error.message : "Unknown error",
          connectorInstanceId: req.params.connectorInstanceId,
        },
        "Layout plan fetch failed"
      );
      return next(
        error instanceof ApiError
          ? error
          : new ApiError(
              500,
              ApiCode.LAYOUT_PLAN_NOT_FOUND,
              error instanceof Error
                ? error.message
                : "Layout plan fetch failed"
            )
      );
    }
  }
);

/**
 * @openapi
 * /api/connector-instances/{connectorInstanceId}/layout-plan/{planId}:
 *   patch:
 *     tags:
 *       - Layout Plans
 *     summary: Patch a layout plan in place
 *     description: |
 *       Merges the partial body onto the stored plan and re-validates the
 *       merged result with `LayoutPlanSchema`. Rejects with 400 when the
 *       merged plan is invalid. No supersede — patch edits the same row.
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: connectorInstanceId
 *         required: true
 *         schema:
 *           type: string
 *       - in: path
 *         name: planId
 *         required: true
 *         schema:
 *           type: string
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             additionalProperties: true
 *     responses:
 *       200:
 *         description: Plan patched
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
 *                     interpretationTrace:
 *                       type: object
 *                       nullable: true
 *       400:
 *         description: Merged plan failed schema validation
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ApiErrorResponse'
 *       404:
 *         description: Plan not found for this connector instance
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ApiErrorResponse'
 */
connectorInstanceLayoutPlansRouter.patch(
  "/:connectorInstanceId/layout-plan/:planId",
  getApplicationMetadata,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { connectorInstanceId, planId } = req.params;
      const { organizationId, userId } = req.application!.metadata;

      const parsed = PatchLayoutPlanBodySchema.safeParse(req.body);
      if (!parsed.success) {
        return next(
          new ApiError(
            400,
            ApiCode.LAYOUT_PLAN_INVALID_PAYLOAD,
            "Invalid patch body",
            { issues: parsed.error.issues }
          )
        );
      }

      const payload = await ConnectorInstanceLayoutPlansService.patch(
        connectorInstanceId,
        planId,
        organizationId,
        userId,
        parsed.data
      );
      return HttpService.success<LayoutPlanResponsePayload>(res, payload);
    } catch (error) {
      logger.error(
        {
          error: error instanceof Error ? error.message : "Unknown error",
          connectorInstanceId: req.params.connectorInstanceId,
          planId: req.params.planId,
        },
        "Layout plan patch failed"
      );
      return next(
        error instanceof ApiError
          ? error
          : new ApiError(
              500,
              ApiCode.LAYOUT_PLAN_INVALID_PAYLOAD,
              error instanceof Error ? error.message : "Patch failed"
            )
      );
    }
  }
);

/**
 * @openapi
 * /api/connector-instances/{connectorInstanceId}/layout-plan/{planId}/commit:
 *   post:
 *     tags:
 *       - Layout Plans
 *     summary: Commit a layout plan — replay + write records
 *     description: |
 *       Runs the spreadsheet-parsing module's `replay()` against the submitted
 *       workbook + the stored plan, gates on the resulting `DriftReport`, then
 *       materializes one `ConnectorEntity` per distinct `targetEntityDefinitionId`,
 *       reconciles `FieldMapping` rows (union across contributing regions,
 *       deduplicated by `ColumnDefinition`), and writes `entity_records` via
 *       `sourceId + checksum` upsert semantics.
 *
 *       Returns 409 with the `DriftReport` body when drift is identity-changing
 *       (`LAYOUT_PLAN_DRIFT_IDENTITY_CHANGED`), at `blocker` severity
 *       (`LAYOUT_PLAN_DRIFT_BLOCKER`), or at `warn` severity with halt knobs
 *       (`LAYOUT_PLAN_DRIFT_HALT`). `info`/`none` severity commits cleanly.
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: connectorInstanceId
 *         required: true
 *         schema:
 *           type: string
 *       - in: path
 *         name: planId
 *         required: true
 *         schema:
 *           type: string
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [workbook]
 *             properties:
 *               workbook:
 *                 type: object
 *                 additionalProperties: true
 *     responses:
 *       200:
 *         description: Commit completed
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 payload:
 *                   $ref: '#/components/schemas/LayoutPlanCommitResult'
 *       400:
 *         description: Invalid workbook payload
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ApiErrorResponse'
 *       404:
 *         description: Plan or connector instance not found
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ApiErrorResponse'
 *       409:
 *         description: |
 *           Commit halted by one of:
 *           - `LAYOUT_PLAN_BLOCKER_WARNINGS` — plan has regions with
 *             blocker-severity warnings; `details.warnings` lists them.
 *           - `LAYOUT_PLAN_DRIFT_IDENTITY_CHANGED` / `LAYOUT_PLAN_DRIFT_BLOCKER`
 *             / `LAYOUT_PLAN_DRIFT_HALT` — replay detected drift;
 *             `details.drift` carries the full `DriftReport`.
 *         content:
 *           application/json:
 *             schema:
 *               allOf:
 *                 - $ref: '#/components/schemas/ApiErrorResponse'
 *                 - type: object
 *                   properties:
 *                     details:
 *                       type: object
 *                       properties:
 *                         drift:
 *                           $ref: '#/components/schemas/DriftReport'
 *                         warnings:
 *                           type: array
 *                           items:
 *                             $ref: '#/components/schemas/Warning'
 */
connectorInstanceLayoutPlansRouter.post(
  "/:connectorInstanceId/layout-plan/:planId/commit",
  getApplicationMetadata,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { connectorInstanceId, planId } = req.params;
      const { organizationId, userId } = req.application!.metadata;

      const parsed = CommitLayoutPlanRequestBodySchema.safeParse(req.body);
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

      const payload = await LayoutPlanCommitService.commit(
        connectorInstanceId,
        planId,
        organizationId,
        userId,
        { workbook: parsed.data.workbook }
      );

      logger.info(
        {
          connectorInstanceId,
          planId,
          organizationId,
          connectorEntityCount: payload.connectorEntityIds.length,
          recordCounts: payload.recordCounts,
        },
        "Layout plan committed"
      );

      return HttpService.success<LayoutPlanCommitResult>(res, payload);
    } catch (error) {
      logger.error(
        {
          error: error instanceof Error ? error.message : "Unknown error",
          connectorInstanceId: req.params.connectorInstanceId,
          planId: req.params.planId,
        },
        "Layout plan commit failed"
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
