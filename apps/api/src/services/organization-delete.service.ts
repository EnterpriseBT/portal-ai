/**
 * Full organization deletion (#197) — the tombstone hybrid:
 *
 * - All org *content* is hard-deleted (every org-scoped table plus the
 *   dynamic `er__*` wide tables and the S3 upload objects).
 * - The `organizations` row and all `organization_users` rows are
 *   soft-deleted (the tombstone — who belonged, who deleted, when).
 * - `usage` and `tool_usage_ledger` rows are retained untouched: they are
 *   the billing record of truth (aggregate + per-call itemization, #179),
 *   and their FK to `organizations.id` is satisfied by the tombstoned org
 *   row. Do not "fix" the tombstone into a hard delete.
 *
 * The caller (route) owns authorization (current-org guard, owner check)
 * and the confirmation-name gate; this service owns the job sweep and the
 * cascade itself.
 */

import { and, eq, inArray, isNull } from "drizzle-orm";

import { DbService } from "./db.service.js";
import { JobLockService } from "./job-lock.service.js";
import { JobsService } from "./jobs.service.js";
import { S3Service } from "./s3.service.js";
import { StripeService } from "./stripe.service.js";
import { wideTableReconcilerService } from "./wide-table-reconciler.service.js";
import { ApiError } from "./http.service.js";
import { ApiCode } from "../constants/api-codes.constants.js";
import {
  apiEndpointConfigs,
  columnDefinitions,
  connectorEntities,
  connectorInstanceLayoutPlans,
  connectorInstances,
  entityGroupMembers,
  entityGroups,
  entityRecords,
  entityTagAssignments,
  entityTags,
  fieldMappings,
  fileUploads,
  jobs,
  organizationToolpacks,
  organizationUsers,
  organizations,
  portalMessages,
  portalResults,
  portals,
  stationInstances,
  stationToolpacks,
  stations,
  wideTableColumns,
} from "../db/schema/index.js";
import { createLogger } from "../utils/logger.util.js";

const logger = createLogger({ module: "organization-delete" });

export class OrganizationDeleteService {
  /**
   * Delete an organization per the #197 contract. Throws
   * `ApiError(409, ENTITY_LOCKED_BY_JOB)` when an `active` job holds the
   * org (queued jobs are auto-cancelled first). The DB cascade runs in a
   * single transaction; S3 cleanup is post-commit best-effort.
   */
  static async deleteOrganization(
    organizationId: string,
    actorUserId: string
  ): Promise<void> {
    logger.info({ organizationId, actorUserId }, "Deleting organization");

    // Read the Stripe linkage before the cascade tombstones the row (#176
    // Q4) — the post-commit cancel below needs the subscription id.
    const org =
      await DbService.repository.organizations.findById(organizationId);

    await OrganizationDeleteService.sweepJobs(organizationId);
    const s3Keys = await OrganizationDeleteService.cascade(
      organizationId,
      actorUserId
    );
    await OrganizationDeleteService.cleanupS3(organizationId, s3Keys);
    await OrganizationDeleteService.cancelStripeSubscription(
      organizationId,
      org?.stripeSubscriptionId ?? null
    );

    logger.info({ organizationId, actorUserId }, "Organization deleted");
  }

  /**
   * Cancel every cancellable non-terminal job, then re-check: anything
   * `active` (a worker mid-run, which has no abort path) blocks the delete
   * with 409. Cancel-then-recheck closes the pending→active window — a
   * cancelled job is dequeued and can't start; one that raced to `active`
   * surfaces in the recheck before the transaction opens.
   */
  private static async sweepJobs(organizationId: string): Promise<void> {
    const running =
      await JobLockService.findRunningForOrganization(organizationId);
    for (const job of running) {
      if (job.status === "active") continue;
      try {
        await JobsService.cancel(job.id);
      } catch (error) {
        // Lost the race to a terminal transition — already what we want.
        if (
          error instanceof ApiError &&
          error.code === ApiCode.JOB_ALREADY_TERMINAL
        ) {
          continue;
        }
        throw error;
      }
    }

    const recheck =
      await JobLockService.findRunningForOrganization(organizationId);
    const active = recheck.filter((job) => job.status === "active");
    if (active.length > 0) {
      throw new ApiError(
        409,
        ApiCode.ENTITY_LOCKED_BY_JOB,
        "Organization is locked by an in-flight job",
        { runningJobs: active }
      );
    }
  }

  /**
   * The cascade transaction — `ResetService.resetOrganization`'s child →
   * parent order extended to full coverage, ending in the tombstone
   * soft-deletes. Returns the S3 keys collected for post-commit cleanup.
   */
  private static async cascade(
    organizationId: string,
    actorUserId: string
  ): Promise<string[]> {
    return DbService.transaction(async (tx) => {
      // Collect before deleting: live entity ids drive the er__* drops
      // (wide-table lifecycle is tightly coupled to its entity — a wide
      // table never outlives its entity row, so the live set is the
      // complete drop list); every upload row's key drives S3 cleanup.
      const entityRows = await tx
        .select({ id: connectorEntities.id })
        .from(connectorEntities)
        .where(
          and(
            eq(connectorEntities.organizationId, organizationId),
            isNull(connectorEntities.deleted)
          )
        );
      const uploadRows = await tx
        .select({ s3Key: fileUploads.s3Key })
        .from(fileUploads)
        .where(eq(fileUploads.organizationId, organizationId));

      // Wide tables first: the catalog rows FK field_mappings /
      // column_definitions, so they must go before those parents.
      for (const { id } of entityRows) {
        await wideTableReconcilerService.dropTable(id, tx);
      }
      await tx
        .delete(wideTableColumns)
        .where(eq(wideTableColumns.organizationId, organizationId));

      await tx
        .delete(entityGroupMembers)
        .where(eq(entityGroupMembers.organizationId, organizationId));
      await tx
        .delete(entityTagAssignments)
        .where(eq(entityTagAssignments.organizationId, organizationId));
      await tx
        .delete(entityRecords)
        .where(eq(entityRecords.organizationId, organizationId));
      await tx
        .delete(fieldMappings)
        .where(eq(fieldMappings.organizationId, organizationId));
      await tx
        .delete(portalResults)
        .where(eq(portalResults.organizationId, organizationId));
      await tx
        .delete(portalMessages)
        .where(eq(portalMessages.organizationId, organizationId));
      await tx
        .delete(portals)
        .where(eq(portals.organizationId, organizationId));

      // Join tables without organizationId — scope via org stations.
      const orgStationIds = tx
        .select({ id: stations.id })
        .from(stations)
        .where(eq(stations.organizationId, organizationId));
      await tx
        .delete(stationToolpacks)
        .where(inArray(stationToolpacks.stationId, orgStationIds));
      await tx
        .delete(stationInstances)
        .where(inArray(stationInstances.stationId, orgStationIds));

      // Break the org → default-station cycle before the stations go.
      await tx
        .update(organizations)
        .set({ defaultStationId: null })
        .where(eq(organizations.id, organizationId));
      await tx
        .delete(stations)
        .where(eq(stations.organizationId, organizationId));

      // Indirectly-scoped: layout plans hang off the org's instances.
      const orgInstanceIds = tx
        .select({ id: connectorInstances.id })
        .from(connectorInstances)
        .where(eq(connectorInstances.organizationId, organizationId));
      await tx
        .delete(connectorInstanceLayoutPlans)
        .where(
          inArray(
            connectorInstanceLayoutPlans.connectorInstanceId,
            orgInstanceIds
          )
        );
      await tx
        .delete(apiEndpointConfigs)
        .where(eq(apiEndpointConfigs.organizationId, organizationId));

      await tx
        .delete(connectorEntities)
        .where(eq(connectorEntities.organizationId, organizationId));
      await tx
        .delete(connectorInstances)
        .where(eq(connectorInstances.organizationId, organizationId));
      await tx
        .delete(entityGroups)
        .where(eq(entityGroups.organizationId, organizationId));
      await tx
        .delete(entityTags)
        .where(eq(entityTags.organizationId, organizationId));
      await tx
        .delete(columnDefinitions)
        .where(eq(columnDefinitions.organizationId, organizationId));

      await tx
        .delete(organizationToolpacks)
        .where(eq(organizationToolpacks.organizationId, organizationId));
      await tx
        .delete(fileUploads)
        .where(eq(fileUploads.organizationId, organizationId));

      // Operational bookkeeping, not billing truth — hard-deleted.
      await tx.delete(jobs).where(eq(jobs.organizationId, organizationId));

      // Tombstones: memberships (owner included) + the org row itself.
      // `usage` rows are deliberately untouched — the tombstoned org row
      // keeps their FK valid.
      const deletedStamp = { deleted: Date.now(), deletedBy: actorUserId };
      await tx
        .update(organizationUsers)
        .set(deletedStamp)
        .where(
          and(
            eq(organizationUsers.organizationId, organizationId),
            isNull(organizationUsers.deleted)
          )
        );
      await tx
        .update(organizations)
        .set(deletedStamp)
        .where(eq(organizations.id, organizationId));

      logger.info(
        {
          organizationId,
          wideTablesDropped: entityRows.length,
          s3KeysCollected: uploadRows.length,
        },
        "Organization cascade committed"
      );

      return uploadRows.map((row) => row.s3Key);
    });
  }

  /**
   * Post-commit, best-effort (#176 Q4): cancel the org's live Stripe
   * subscription immediately so a deleted org stops billing. Like the S3
   * cleanup, a Stripe outage never blocks deletion — failure logs a warn
   * with the ids for manual reconciliation. The tombstoned row keeps both
   * Stripe ids.
   */
  private static async cancelStripeSubscription(
    organizationId: string,
    stripeSubscriptionId: string | null
  ): Promise<void> {
    if (!stripeSubscriptionId) return;
    try {
      await StripeService.cancelSubscription(stripeSubscriptionId);
      logger.info(
        { organizationId, stripeSubscriptionId },
        "Cancelled Stripe subscription during organization delete"
      );
    } catch (error) {
      logger.warn(
        {
          organizationId,
          stripeSubscriptionId,
          error: error instanceof Error ? error.message : "Unknown error",
        },
        "Failed to cancel Stripe subscription during organization delete — reconcile manually"
      );
    }
  }

  /**
   * Post-commit, best-effort: the rows referencing these objects are gone,
   * so a failed delete leaves an unreachable orphan — logged for a manual
   * sweep, never surfaced to the caller.
   */
  private static async cleanupS3(
    organizationId: string,
    s3Keys: string[]
  ): Promise<void> {
    for (const s3Key of s3Keys) {
      try {
        await S3Service.deleteObject(s3Key);
      } catch (error) {
        logger.warn(
          {
            organizationId,
            s3Key,
            error: error instanceof Error ? error.message : "Unknown error",
          },
          "Failed to delete S3 object during organization delete"
        );
      }
    }
  }
}
