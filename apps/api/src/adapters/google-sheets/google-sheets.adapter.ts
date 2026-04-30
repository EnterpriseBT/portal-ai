/**
 * Google Sheets connector adapter.
 *
 * Phase A: `toPublicAccountInfo` for the redaction serializer.
 * Phase D: `syncInstance` + `assertSyncEligibility` for manual sync.
 *
 * The shared sync route (`POST /api/connector-instances/:id/sync`) is
 * connector-agnostic — it resolves this adapter via the definition
 * slug and dispatches the eligibility gate + sync pipeline here. The
 * gsheets-specific layout-plan + rowPosition guard lives below in
 * `assertSyncEligibility`; the same logic is mirrored on the
 * `syncEligible` field served from GET-by-id so the UI's
 * "Sync now" button can disable upfront.
 *
 * See `docs/GOOGLE_SHEETS_CONNECTOR.phase-{A,D}.plan.md`.
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
import { GoogleSheetsConnectorService } from "../../services/google-sheets-connector.service.js";
import { LayoutPlanCommitService } from "../../services/layout-plan-commit.service.js";
import { assertSyncEligibleIdentity } from "../../services/sync-eligibility.util.js";
import { createLogger } from "../../utils/logger.util.js";

const logger = createLogger({ module: "google-sheets-adapter" });

function notImplemented(method: string): never {
  throw new Error(
    `googleSheetsAdapter.${method} is not implemented yet (Phase E)`
  );
}

/**
 * Gsheets-specific eligibility gate. The instance must have a current
 * (non-superseded) layout plan, and that plan's regions must all use
 * stable identity strategies (`column` or `composite`). A region using
 * `rowPosition` identity has synthesized cell-position ids that shift
 * on every row insert/delete in the source sheet, making sync
 * pathological churn — refuse upfront.
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
  const eligibility = assertSyncEligibleIdentity(planRow.plan as LayoutPlan);
  if (!eligibility.ok) {
    return {
      ok: false,
      reasonCode: ApiCode.LAYOUT_PLAN_SYNC_INELIGIBLE_IDENTITY,
      reason: `Plan has ${eligibility.ineligibleRegionIds.length} region(s) using row-position identity; not eligible for sync. Re-edit the regions to add an identifier column.`,
      details: { ineligibleRegionIds: eligibility.ineligibleRegionIds },
    };
  }
  return { ok: true };
}

export const googleSheetsAdapter: ConnectorAdapter = {
  toPublicAccountInfo(
    credentials: Record<string, unknown> | null
  ): PublicAccountInfo {
    if (!credentials) return EMPTY_ACCOUNT_INFO;
    const email = credentials.googleAccountEmail;
    if (typeof email !== "string" || email.length === 0) {
      return EMPTY_ACCOUNT_INFO;
    }
    return { identity: email, metadata: {} };
  },

  assertSyncEligibility,

  async syncInstance(
    instance: ConnectorInstance,
    userId: string,
    progress?: (percent: number) => void
  ): Promise<SyncInstanceResult> {
    const runStartedAt = Date.now();
    progress?.(0);

    // 1. Defensive eligibility gate. The shared sync route normally
    //    pre-flights this before enqueueing, but the processor can be
    //    reached through other paths so we re-check here.
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
      // Re-checked by `assertSyncEligibility` above, but TypeScript
      // doesn't carry the narrowing across the await boundary.
      throw new ApiError(
        404,
        ApiCode.LAYOUT_PLAN_NOT_FOUND,
        `No layout plan committed for instance ${instance.id}`
      );
    }
    progress?.(10);

    // 2. Fetch the workbook fresh from Google.
    const workbook = await GoogleSheetsConnectorService.fetchWorkbookForSync(
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
        event: "gsheets.sync.completed",
        connectorInstanceId: instance.id,
        runStartedAt,
        recordCounts: { ...commitResult.recordCounts, deleted },
      },
      "Google Sheets sync completed"
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
