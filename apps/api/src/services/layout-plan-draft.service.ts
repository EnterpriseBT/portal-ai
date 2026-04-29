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
import type { WorkbookData } from "@portalai/spreadsheet-parsing";

import { ApiCode } from "../constants/api-codes.constants.js";
import { DbService } from "./db.service.js";
import { FileUploadSessionService } from "./file-upload-session.service.js";
import { GoogleSheetsConnectorService } from "./google-sheets-connector.service.js";
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
    const workbook = await resolveWorkbook(body, organizationId);
    try {
      const plan = await LayoutPlanInterpretService.analyze(
        workbook,
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

    // ── Resolve the workbook (file-upload OR google-sheets cache) ────
    const workbook = await resolveWorkbook(body, organizationId);

    // ── Resolve the target ConnectorInstance ──────────────────────────
    // Two paths: create-fresh (uploadSessionId) or use-existing-pending
    // (connectorInstanceId). The latter flips a pending instance to
    // active without touching credentials, config, or name — those came
    // from the OAuth callback.
    let connectorInstanceId: string;
    let isExistingInstance = false;
    if (body.connectorInstanceId) {
      const existing =
        await DbService.repository.connectorInstances.findById(
          body.connectorInstanceId
        );
      if (!existing) {
        throw new ApiError(
          404,
          ApiCode.CONNECTOR_INSTANCE_NOT_FOUND,
          `Connector instance not found: ${body.connectorInstanceId}`
        );
      }
      if (existing.organizationId !== organizationId) {
        throw new ApiError(
          403,
          ApiCode.CONNECTOR_INSTANCE_NOT_FOUND,
          "Connector instance belongs to a different organization"
        );
      }
      connectorInstanceId = existing.id;
      isExistingInstance = true;
    } else {
      const definition =
        await DbService.repository.connectorDefinitions.findById(
          body.connectorDefinitionId
        );
      if (!definition) {
        throw new ApiError(
          404,
          ApiCode.CONNECTOR_DEFINITION_NOT_FOUND,
          `Connector definition not found: ${body.connectorDefinitionId}`
        );
      }
      connectorInstanceId = SystemUtilities.id.v4.generate();
      await DbService.repository.connectorInstances.create({
        id: connectorInstanceId,
        organizationId,
        connectorDefinitionId: body.connectorDefinitionId,
        name: body.name,
        status: "active",
        enabledCapabilityFlags: { ...definition.capabilityFlags },
        config: null,
        credentials: null,
        created: Date.now(),
        createdBy: userId,
        updated: null,
        updatedBy: null,
        deleted: null,
        deletedBy: null,
      });
    }

    // ── Create the layout-plan row FK-bound to the instance ──────────
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
      // Roll back the instance ONLY if we just created it. Existing-instance
      // path (google-sheets) leaves the pending instance untouched so the
      // user can retry without re-authorizing.
      if (!isExistingInstance) {
        await DbService.repository.connectorInstances
          .hardDelete(connectorInstanceId)
          .catch(() => undefined);
      }
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
        { workbook }
      );
    } catch (err) {
      logger.warn(
        {
          event: "commit-draft.rollback",
          connectorInstanceId,
          planId,
          isExistingInstance,
          reason: err instanceof Error ? err.message : String(err),
        },
        "rolling back draft commit"
      );
      await DbService.repository.connectorInstanceLayoutPlans
        .hardDelete(planId)
        .catch(() => undefined);
      // Only delete the instance if we created it. The existing-instance
      // (google-sheets) path leaves the pending instance in place.
      if (!isExistingInstance) {
        await DbService.repository.connectorInstances
          .hardDelete(connectorInstanceId)
          .catch(() => undefined);
      }
      throw err;
    }

    // Commit succeeded.
    if (body.uploadSessionId) {
      // file-upload pipeline — mark session committed + S3 cleanup.
      FileUploadSessionService.markSessionCommitted(body.uploadSessionId).catch(
        (err) => {
          logger.warn(
            {
              uploadSessionId: body.uploadSessionId,
              err: err instanceof Error ? err.message : err,
            },
            "Failed to mark upload session committed (non-fatal)"
          );
        }
      );
    } else if (isExistingInstance) {
      // google-sheets pipeline — flip the pending instance to active.
      // (The instance was never deleted on rollback paths above so this
      // is the first state mutation on the success path.)
      await DbService.repository.connectorInstances
        .update(connectorInstanceId, { status: "active", updatedBy: userId })
        .catch((err) => {
          logger.warn(
            {
              connectorInstanceId,
              err: err instanceof Error ? err.message : err,
            },
            "Failed to flip pending → active after commit (non-fatal)"
          );
        });
    }

    return {
      connectorInstanceId,
      planId,
      recordCounts: result.recordCounts,
    };
  }
}

/**
 * Resolve the workbook for a draft-flow request. Dispatches by which
 * session id the body carries:
 *   - `uploadSessionId`     → file-upload Redis cache (`upload-session:{id}`)
 *                             with S3 re-stream fallback on cache miss.
 *   - `connectorInstanceId` → google-sheets Redis cache (`gsheets:wb:{id}`).
 *                             No fallback; cache miss is a 404.
 *
 * The contract refinement guarantees exactly one is present.
 */
async function resolveWorkbook(
  body:
    | LayoutPlanInterpretDraftRequestBody
    | LayoutPlanCommitDraftRequestBody,
  organizationId: string
): Promise<WorkbookData> {
  if (body.uploadSessionId) {
    return FileUploadSessionService.resolveWorkbook(
      body.uploadSessionId,
      organizationId
    );
  }
  if (body.connectorInstanceId) {
    return GoogleSheetsConnectorService.resolveWorkbook(
      body.connectorInstanceId,
      organizationId
    );
  }
  throw new ApiError(
    400,
    ApiCode.LAYOUT_PLAN_INVALID_PAYLOAD,
    "Body must include either uploadSessionId or connectorInstanceId"
  );
}
