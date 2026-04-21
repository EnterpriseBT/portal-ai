/**
 * Instance-less layout-plan orchestration.
 *
 * Used by the "new connector" flows (FileUploadConnector today) where the
 * ConnectorInstance is created only when the user confirms the review step —
 * eliminating the orphan-instance problem that falls out of the prior
 * interpret-time creation.
 *
 * Two entry points:
 *   - `interpretDraft`  — pure compute, no DB writes. Returns the plan.
 *   - `commitDraft`      — creates the ConnectorInstance + layout-plan row,
 *                          runs the existing commit pipeline, and on any
 *                          failure hard-deletes the instance and plan row
 *                          so no partial state leaks.
 */

import type {
  LayoutPlan,
  LayoutPlanCommitDraftRequestBody,
  LayoutPlanCommitDraftResponsePayload,
  LayoutPlanCommitResult,
  LayoutPlanInterpretDraftRequestBody,
  LayoutPlanInterpretDraftResponsePayload,
} from "@portalai/core/contracts";
import { LayoutPlanSchema } from "@portalai/core/contracts";

import { ApiCode } from "../constants/api-codes.constants.js";
import { DbService } from "./db.service.js";
import { LayoutPlanCommitService } from "./layout-plan-commit.service.js";
import { LayoutPlanInterpretService } from "./layout-plan-interpret.service.js";
import { ApiError } from "./http.service.js";
import { SystemUtilities } from "../utils/system.util.js";
import { createLogger } from "../utils/logger.util.js";

const logger = createLogger({ module: "layout-plan-draft" });

export class LayoutPlanDraftService {
  /**
   * Run the parser module's `interpret()` without persisting anything.
   * Returns the plan so the client can drive the review step in memory.
   */
  static async interpretDraft(
    organizationId: string,
    userId: string,
    body: LayoutPlanInterpretDraftRequestBody
  ): Promise<LayoutPlanInterpretDraftResponsePayload> {
    try {
      const plan = await LayoutPlanInterpretService.analyze(
        body.workbook,
        body.regionHints ?? [],
        organizationId,
        userId
      );
      return { plan };
    } catch (err) {
      throw new ApiError(
        500,
        ApiCode.LAYOUT_PLAN_INTERPRET_FAILED,
        err instanceof Error ? err.message : "Interpret failed"
      );
    }
  }

  /**
   * Create the ConnectorInstance + layout-plan row + records atomically.
   * On any failure past the instance insert, hard-delete both so the caller
   * never sees an orphan.
   */
  static async commitDraft(
    organizationId: string,
    userId: string,
    body: LayoutPlanCommitDraftRequestBody
  ): Promise<LayoutPlanCommitDraftResponsePayload> {
    // ── Validate the plan envelope up-front so we reject bad input before
    //    writing anything to the DB. ────────────────────────────────────
    const parsedPlan = LayoutPlanSchema.safeParse(body.plan);
    if (!parsedPlan.success) {
      throw new ApiError(
        400,
        ApiCode.LAYOUT_PLAN_INVALID_PAYLOAD,
        `Invalid plan envelope: ${parsedPlan.error.issues
          .map((i) => i.message)
          .join("; ")}`,
        { issues: parsedPlan.error.issues }
      );
    }
    const plan: LayoutPlan = parsedPlan.data;

    // ── Create the ConnectorInstance ─────────────────────────────────
    const connectorInstanceId = SystemUtilities.id.v4.generate();
    await DbService.repository.connectorInstances.create({
      id: connectorInstanceId,
      organizationId,
      connectorDefinitionId: body.connectorDefinitionId,
      name: body.name,
      status: "active",
      enabledCapabilityFlags: { sync: true },
      config: null,
      credentials: null,
      created: Date.now(),
      createdBy: userId,
      updated: null,
      updatedBy: null,
      deleted: null,
      deletedBy: null,
    });

    // ── Create the layout-plan row FK-bound to the fresh instance ────
    const planId = SystemUtilities.id.v4.generate();
    try {
      await DbService.repository.connectorInstanceLayoutPlans.create({
        id: planId,
        connectorInstanceId,
        planVersion: plan.planVersion,
        revisionTag: null,
        plan,
        interpretationTrace: null,
        supersededBy: null,
        created: Date.now(),
        createdBy: userId,
        updated: null,
        updatedBy: null,
        deleted: null,
        deletedBy: null,
      });
    } catch (err) {
      // Roll back the instance so we don't leave an orphan when the plan
      // row insert fails (e.g. validation trigger, FK timing).
      await DbService.repository.connectorInstances
        .hardDelete(connectorInstanceId)
        .catch(() => undefined);
      throw err;
    }

    // ── Run the existing commit pipeline ─────────────────────────────
    let result: LayoutPlanCommitResult;
    try {
      result = await LayoutPlanCommitService.commit(
        connectorInstanceId,
        planId,
        organizationId,
        userId,
        { workbook: body.workbook }
      );
    } catch (err) {
      // Tear down both rows so the UI never shows a half-committed
      // connector. Failures here are likely drift/blocker gates (409s) or
      // unexpected replay errors — either way the client can retry.
      logger.warn(
        {
          event: "commit-draft.rollback",
          connectorInstanceId,
          planId,
          reason: err instanceof Error ? err.message : String(err),
        },
        "rolling back draft commit"
      );
      await DbService.repository.connectorInstanceLayoutPlans
        .hardDelete(planId)
        .catch(() => undefined);
      await DbService.repository.connectorInstances
        .hardDelete(connectorInstanceId)
        .catch(() => undefined);
      throw err;
    }

    return {
      connectorInstanceId,
      planId,
      recordCounts: result.recordCounts,
    };
  }
}
