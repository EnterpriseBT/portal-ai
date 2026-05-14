/**
 * Instance-less layout-plan orchestration.
 *
 * Used by the "new connector" flows (FileUploadConnector,
 * GoogleSheetsConnector, MicrosoftExcelConnector) where the
 * ConnectorInstance is created only when the user confirms the review
 * step — eliminating the orphan-instance problem that falls out of
 * prior interpret-time creation.
 *
 * Three entry points, split across the request thread / worker
 * thread boundary that the async commit pipeline introduces:
 *
 *   - `interpretDraft`        — pure compute, no DB writes. Runs
 *                                in-route. Returns the plan.
 *   - `prepareDraftCommit`    — sync; validates inputs, resolves the
 *                                target connector definition or
 *                                existing pending instance, mints
 *                                fresh `connectorInstanceId` /
 *                                `planId` UUIDs, and returns the
 *                                metadata the route hands to
 *                                `JobsService.create`. Does NOT touch
 *                                the database.
 *   - `runCommitDraft`        — runs in the layout-plan-commit
 *                                processor. Owns every DB write that
 *                                used to be inline — creates the
 *                                connector_instance row (when not
 *                                `isExistingInstance`), creates the
 *                                plan row, runs the records-write
 *                                pipeline, rolls back on failure.
 *
 * `prepareRecommit` / `runRecommit` are the recommit-endpoint
 * analogs (existing instance + plan; worker only writes records).
 */

import type {
  LayoutPlan,
  LayoutPlanCommitDraftRequestBody,
  LayoutPlanInterpretDraftRequestBody,
  LayoutPlanInterpretDraftResponsePayload,
} from "@portalai/core/contracts";
import { LayoutPlanSchema } from "@portalai/core/contracts";
import type {
  LayoutPlanCommitJobResult,
  LayoutPlanCommitMetadata,
  LayoutPlanCommitWorkbookSource,
} from "@portalai/core/models";
import type { Workbook } from "@portalai/spreadsheet-parsing";

import { ApiCode } from "../constants/api-codes.constants.js";
import { DbService } from "./db.service.js";
import { FileUploadSessionService } from "./file-upload-session.service.js";
import { GoogleSheetsConnectorService } from "./google-sheets-connector.service.js";
import { LayoutPlanCommitService } from "./layout-plan-commit.service.js";
import { LayoutPlanInterpretService } from "./layout-plan-interpret.service.js";
import { MicrosoftExcelConnectorService } from "./microsoft-excel-connector.service.js";
import { ApiError } from "./http.service.js";
import { SystemUtilities } from "../utils/system.util.js";
import { createLogger } from "../utils/logger.util.js";

const logger = createLogger({ module: "layout-plan-draft" });

export interface PreparedDraftCommit {
  connectorInstanceId: string;
  planId: string;
  metadata: Extract<LayoutPlanCommitMetadata, { kind: "draft" }>;
}

export interface PreparedRecommit {
  connectorInstanceId: string;
  planId: string;
  metadata: Extract<LayoutPlanCommitMetadata, { kind: "recommit" }>;
}

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
    const workbook = await resolveWorkbookFromBody(body, organizationId);
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
   * Synchronous prep for the draft commit endpoint. Validates the plan
   * envelope, resolves the target connector definition / existing
   * pending instance, and creates the `connector_instances` row
   * (status="pending" for the fresh-create path) + the
   * `connector_instance_layout_plans` row before enqueueing.
   *
   * Creating the rows in-route — not in the worker — is what lets the
   * client navigate to `/connectors/:id` immediately after the 202.
   * The lock alert in the connector-instance view (driven by
   * `JobLockService`) then surfaces the pending `layout_plan_commit`
   * job as the "import in progress" confirmation. If we deferred the
   * inserts to the worker, the destination view would 404 for the
   * full duration of the job (often tens of seconds on ~400k-row
   * uploads).
   *
   * Orphan-safety still belongs to the worker: it flips status from
   * `pending` → `active` on success, or hard-deletes the instance +
   * plan on failure (only when the route created them — pre-existing
   * instances on the OAuth path are never deleted on commit
   * rollback).
   */
  static async prepareDraftCommit(
    organizationId: string,
    userId: string,
    body: LayoutPlanCommitDraftRequestBody
  ): Promise<PreparedDraftCommit> {
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

    let connectorInstanceId: string;
    let isExistingInstance = false;
    let workbookSource: LayoutPlanCommitWorkbookSource;

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
      workbookSource = {
        kind: "connectorInstance",
        connectorInstanceId: existing.id,
      };
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
        status: "pending",
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
      // Body refinement guarantees uploadSessionId is present when
      // connectorInstanceId is not.
      workbookSource = {
        kind: "uploadSession",
        uploadSessionId: body.uploadSessionId!,
      };
    }

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
      // Plan insert failed (e.g. constraint violation) — undo the
      // freshly-created instance so we don't leave an orphan. The
      // existing-instance path is the OAuth callback's row and stays
      // untouched.
      if (!isExistingInstance) {
        await DbService.repository.connectorInstances
          .hardDelete(connectorInstanceId)
          .catch(() => undefined);
      }
      throw err;
    }

    return {
      connectorInstanceId,
      planId,
      metadata: {
        kind: "draft",
        organizationId,
        userId,
        connectorInstanceId,
        planId,
        connectorDefinitionId: body.connectorDefinitionId,
        name: body.name,
        isExistingInstance,
        plan,
        workbookSource,
      },
    };
  }

  /**
   * Worker entry point for the draft commit flow. The route already
   * created the `connector_instances` + `connector_instance_layout_plans`
   * rows (status="pending" for the fresh-create path) so the user could
   * navigate to the instance view immediately. This method resolves the
   * workbook, runs the records-write pipeline, then either flips the
   * instance to `active` on success or hard-deletes the just-created
   * rows on failure. Existing-instance commits (the OAuth callback's
   * pending row) are never deleted — the user can re-try.
   */
  static async runCommitDraft(
    metadata: Extract<LayoutPlanCommitMetadata, { kind: "draft" }>,
    onProgress?: (percent: number) => void
  ): Promise<LayoutPlanCommitJobResult> {
    const {
      organizationId,
      userId,
      connectorInstanceId,
      planId,
      isExistingInstance,
      workbookSource,
    } = metadata;

    const workbook = await LayoutPlanDraftService.resolveWorkbookBySource(
      workbookSource,
      organizationId
    );

    let result;
    try {
      result = await LayoutPlanCommitService.commit(
        connectorInstanceId,
        planId,
        organizationId,
        userId,
        { workbook },
        { onProgress }
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
      if (!isExistingInstance) {
        await DbService.repository.connectorInstances
          .hardDelete(connectorInstanceId)
          .catch(() => undefined);
      }
      throw err;
    }

    // Commit succeeded — flip the instance to `active` so the
    // pending chip on the detail view clears. The instance was
    // created by either this commit's route call
    // (`status: "pending"`) or the OAuth callback (also `pending`);
    // either way the flip is correct.
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

    if (workbookSource.kind === "uploadSession") {
      FileUploadSessionService.markSessionCommitted(
        workbookSource.uploadSessionId
      ).catch((err) => {
        logger.warn(
          {
            uploadSessionId: workbookSource.uploadSessionId,
            err: err instanceof Error ? err.message : err,
          },
          "Failed to mark upload session committed (non-fatal)"
        );
      });
    }

    return {
      connectorInstanceId,
      planId,
      connectorEntityIds: result.connectorEntityIds,
      recordCounts: result.recordCounts,
    };
  }

  /**
   * Synchronous validation for the recommit endpoint. Verifies the
   * connector instance + plan row exist and belong to the caller's
   * org, then returns the metadata the route hands to
   * `JobsService.create`. No DB writes.
   */
  static async prepareRecommit(
    organizationId: string,
    userId: string,
    connectorInstanceId: string,
    planId: string,
    workbookSource: LayoutPlanCommitWorkbookSource
  ): Promise<PreparedRecommit> {
    const instance =
      await DbService.repository.connectorInstances.findById(
        connectorInstanceId
      );
    if (!instance || instance.organizationId !== organizationId) {
      throw new ApiError(
        404,
        ApiCode.CONNECTOR_INSTANCE_NOT_FOUND,
        "Connector instance not found"
      );
    }
    const planRow =
      await DbService.repository.connectorInstanceLayoutPlans.findById(planId);
    if (!planRow || planRow.connectorInstanceId !== connectorInstanceId) {
      throw new ApiError(
        404,
        ApiCode.LAYOUT_PLAN_NOT_FOUND,
        "Layout plan not found for this connector instance"
      );
    }
    return {
      connectorInstanceId,
      planId,
      metadata: {
        kind: "recommit",
        organizationId,
        userId,
        connectorInstanceId,
        planId,
        workbookSource,
      },
    };
  }

  /**
   * Worker entry point for the recommit flow. Resolves the workbook
   * from cache, hands off to the existing commit service. The plan
   * row already exists; failures don't roll back any state — the
   * caller is expected to retry against the same plan.
   */
  static async runRecommit(
    metadata: Extract<LayoutPlanCommitMetadata, { kind: "recommit" }>,
    onProgress?: (percent: number) => void
  ): Promise<LayoutPlanCommitJobResult> {
    const {
      organizationId,
      userId,
      connectorInstanceId,
      planId,
      workbookSource,
    } = metadata;

    const workbook = await LayoutPlanDraftService.resolveWorkbookBySource(
      workbookSource,
      organizationId
    );

    const result = await LayoutPlanCommitService.commit(
      connectorInstanceId,
      planId,
      organizationId,
      userId,
      { workbook },
      { onProgress }
    );

    return {
      connectorInstanceId,
      planId,
      connectorEntityIds: result.connectorEntityIds,
      recordCounts: result.recordCounts,
    };
  }

  /**
   * Resolve the workbook for either commit kind from its
   * `LayoutPlanCommitWorkbookSource` reference. Public so the
   * processor (and any future caller working from job metadata) can
   * avoid threading the original request body around.
   */
  static async resolveWorkbookBySource(
    source: LayoutPlanCommitWorkbookSource,
    organizationId: string
  ): Promise<Workbook> {
    if (source.kind === "uploadSession") {
      return FileUploadSessionService.resolveWorkbook(
        source.uploadSessionId,
        organizationId
      );
    }
    const slug = await loadConnectorSlug(source.connectorInstanceId);
    switch (slug) {
      case "google-sheets":
        return GoogleSheetsConnectorService.resolveWorkbook(
          source.connectorInstanceId,
          organizationId
        );
      case "microsoft-excel":
        return MicrosoftExcelConnectorService.resolveWorkbook(
          source.connectorInstanceId,
          organizationId
        );
      default:
        throw new ApiError(
          400,
          ApiCode.LAYOUT_PLAN_INVALID_PAYLOAD,
          `Connector slug "${slug}" does not support layout-plan workflows`
        );
    }
  }
}

/**
 * Legacy body-shaped resolver used by `interpretDraft` (still
 * synchronous, still in-route). Forwards to
 * `resolveWorkbookBySource` after converting the body's flat fields
 * to a discriminated source ref.
 */
async function resolveWorkbookFromBody(
  body: LayoutPlanInterpretDraftRequestBody,
  organizationId: string
): Promise<Workbook> {
  if (body.uploadSessionId) {
    return LayoutPlanDraftService.resolveWorkbookBySource(
      { kind: "uploadSession", uploadSessionId: body.uploadSessionId },
      organizationId
    );
  }
  if (body.connectorInstanceId) {
    return LayoutPlanDraftService.resolveWorkbookBySource(
      {
        kind: "connectorInstance",
        connectorInstanceId: body.connectorInstanceId,
      },
      organizationId
    );
  }
  throw new ApiError(
    400,
    ApiCode.LAYOUT_PLAN_INVALID_PAYLOAD,
    "Body must include either uploadSessionId or connectorInstanceId"
  );
}

/**
 * Resolve the connector definition's slug for a connector instance.
 * Two roundtrips (instance → definition) is fine on this code path —
 * called once per interpret/commit request, not in a tight loop.
 */
async function loadConnectorSlug(
  connectorInstanceId: string
): Promise<string> {
  const instance =
    await DbService.repository.connectorInstances.findById(
      connectorInstanceId
    );
  if (!instance) {
    throw new ApiError(
      404,
      ApiCode.CONNECTOR_INSTANCE_NOT_FOUND,
      `Connector instance ${connectorInstanceId} not found`
    );
  }
  const definition =
    await DbService.repository.connectorDefinitions.findById(
      instance.connectorDefinitionId
    );
  if (!definition) {
    throw new ApiError(
      500,
      ApiCode.CONNECTOR_INSTANCE_NOT_FOUND,
      `Connector definition ${instance.connectorDefinitionId} not found for instance ${connectorInstanceId}`
    );
  }
  return definition.slug;
}
