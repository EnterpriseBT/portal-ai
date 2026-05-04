/**
 * Microsoft 365 Excel connector adapter.
 *
 * Mirror of `googleSheetsAdapter`: same eligibility model, same six-step
 * sync pipeline, same shape of progress reporting + `recordCounts`. The
 * single divergence is `fetchWorkbookForSync` calls Microsoft Graph
 * (head pre-flight + content download + xlsx parse) instead of Google's
 * `spreadsheets.get`.
 */

import {
  EMPTY_ACCOUNT_INFO,
  type LayoutPlan,
  type PublicAccountInfo,
} from "@portalai/core/contracts";
import type { ConnectorInstance } from "@portalai/core/models";

import { ApiCode } from "../../constants/api-codes.constants.js";
import {
  ConnectorAdapter,
  SyncEligibility,
  SyncInstanceResult,
} from "../adapter.interface.js";
import { ApiError } from "../../services/http.service.js";
import { DbService } from "../../services/db.service.js";
import { LayoutPlanCommitService } from "../../services/layout-plan-commit.service.js";
import { MicrosoftExcelConnectorService } from "../../services/microsoft-excel-connector.service.js";
import { assertSyncEligibleIdentity } from "../../services/sync-eligibility.util.js";
import { createLogger } from "../../utils/logger.util.js";

const logger = createLogger({ module: "microsoft-excel-adapter" });

function notImplemented(method: string): never {
  throw new Error(
    `microsoftExcelAdapter.${method} is not implemented yet`
  );
}

/**
 * Same eligibility model as gsheets: missing layout plan is the only
 * hard refusal. `rowPosition` regions sync correctly but produce
 * reap-and-recreate deltas on every structural change in the source
 * workbook, surfaced as advisory `identityWarnings` instead of gated.
 */
async function assertSyncEligibility(
  instance: ConnectorInstance
): Promise<SyncEligibility> {
  const planRow =
    await DbService.repository.connectorInstanceLayoutPlans.findCurrentByConnectorInstanceId(
      instance.id
    );
  if (!planRow) {
    return {
      ok: false,
      reasonCode: ApiCode.LAYOUT_PLAN_NOT_FOUND,
      reason: `No layout plan committed for instance ${instance.id} — commit the workflow before syncing`,
    };
  }
  const check = assertSyncEligibleIdentity(planRow.plan as LayoutPlan);
  return { ok: true, identityWarnings: check.identityWarnings };
}

export const microsoftExcelAdapter: ConnectorAdapter = {
  toPublicAccountInfo(
    credentials: Record<string, unknown> | null
  ): PublicAccountInfo {
    if (!credentials) return EMPTY_ACCOUNT_INFO;
    const upn = credentials.microsoftAccountUpn;
    if (typeof upn !== "string" || upn.length === 0) {
      return EMPTY_ACCOUNT_INFO;
    }
    const metadata: Record<string, string | number | boolean> = {};
    if (typeof credentials.microsoftAccountDisplayName === "string") {
      metadata.displayName = credentials.microsoftAccountDisplayName;
    }
    if (typeof credentials.tenantId === "string") {
      metadata.tenantId = credentials.tenantId;
    }
    if (
      typeof credentials.microsoftAccountEmail === "string" &&
      credentials.microsoftAccountEmail.length > 0
    ) {
      metadata.email = credentials.microsoftAccountEmail;
    }
    return { identity: upn, metadata };
  },

  assertSyncEligibility,

  async syncInstance(
    instance: ConnectorInstance,
    userId: string,
    progress?: (percent: number) => void
  ): Promise<SyncInstanceResult> {
    const runStartedAt = Date.now();
    progress?.(0);

    // 1. Defensive eligibility re-check — the shared sync route
    //    pre-flights this before enqueueing, but the BullMQ processor
    //    can be reached through other paths so we re-check here.
    const eligibility = await assertSyncEligibility(instance);
    if (!eligibility.ok) {
      throw new ApiError(
        eligibility.reasonCode === ApiCode.LAYOUT_PLAN_NOT_FOUND ? 404 : 409,
        (eligibility.reasonCode as ApiCode) ?? ApiCode.SYNC_NOT_SUPPORTED,
        eligibility.reason ?? "Sync not eligible for this instance",
        eligibility.details
      );
    }
    const planRow =
      await DbService.repository.connectorInstanceLayoutPlans.findCurrentByConnectorInstanceId(
        instance.id
      );
    if (!planRow) {
      throw new ApiError(
        404,
        ApiCode.LAYOUT_PLAN_NOT_FOUND,
        `No layout plan committed for instance ${instance.id}`
      );
    }
    progress?.(10);

    // 2. Fetch the workbook fresh from Graph. The cache layer's
    //    refresh-token rotation persistence runs transparently inside
    //    `MicrosoftAccessTokenCacheService.getOrRefresh`.
    const workbook =
      await MicrosoftExcelConnectorService.fetchWorkbookForSync(
        instance.id,
        instance.organizationId
      );
    progress?.(40);

    // 3. Run the commit pipeline with sync overrides:
    //    - syncedAt = runStartedAt so the watermark reaper can identify
    //      stale rows (those NOT touched by this run).
    //    - skipDriftGate because drift is the point of sync.
    const commitResult = await LayoutPlanCommitService.commit(
      instance.id,
      planRow.id,
      instance.organizationId,
      userId,
      { workbook },
      { syncedAt: runStartedAt, skipDriftGate: true }
    );
    progress?.(80);

    // 4. Per-entity reap: anything whose syncedAt is older than the
    //    run's watermark didn't appear in the fresh fetch — soft-delete.
    let deleted = 0;
    for (const connectorEntityId of commitResult.connectorEntityIds) {
      deleted +=
        await DbService.repository.entityRecords.softDeleteBeforeWatermark(
          connectorEntityId,
          runStartedAt,
          userId
        );
    }
    progress?.(95);

    // 5. Mark the instance as synced; clear any prior error.
    await DbService.repository.connectorInstances.update(instance.id, {
      lastSyncAt: Date.now(),
      lastErrorMessage: null,
      updatedBy: userId,
    });
    progress?.(100);

    logger.info(
      {
        event: "mexcel.sync.completed",
        connectorInstanceId: instance.id,
        runStartedAt,
        recordCounts: { ...commitResult.recordCounts, deleted },
      },
      "Microsoft Excel sync completed"
    );

    return {
      recordCounts: {
        created: commitResult.recordCounts.created,
        updated: commitResult.recordCounts.updated,
        unchanged: commitResult.recordCounts.unchanged,
        deleted,
      },
    };
  },

  async queryRows() {
    return notImplemented("queryRows");
  },
  async discoverEntities() {
    return notImplemented("discoverEntities");
  },
  async discoverColumns() {
    return notImplemented("discoverColumns");
  },
};
