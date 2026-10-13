/**
 * Sync service for triggering connector syncs.
 *
 * Connector-agnostic: the per-instance flow resolves the appropriate
 * adapter via `instance.connectorDefinitionId → definition.slug`, then
 * delegates the eligibility gate (`adapter.assertSyncEligibility`) and
 * the actual pipeline (`adapter.syncInstance`) to it. The job type
 * (`connector_sync`), the BullMQ metadata, and the response shape are
 * uniform across every sync-capable connector — gsheets today, plus
 * future Microsoft Excel, SQL/database, and others.
 */

import type { ConnectorSyncMetadata, JobType } from "@portalai/core/models";

import type { ConnectorAdapter } from "../adapters/adapter.interface.js";
import { ConnectorAdapterRegistry } from "../adapters/adapter.registry.js";
import { ApiCode } from "../constants/api-codes.constants.js";
import type { ConnectorInstanceSelect } from "../db/schema/zod.js";
import { DbService } from "./db.service.js";
import { ApiError } from "./http.service.js";
import { JobLockService } from "./job-lock.service.js";
import { createLogger } from "../utils/logger.util.js";

const logger = createLogger({ module: "sync-service" });

/** BullMQ job type for per-instance syncs. Same value across all connectors. */
const CONNECTOR_SYNC_JOB_TYPE: JobType = "connector_sync";

export class SyncService {
  /**
   * Resolve the adapter for a connector instance. Throws 404 if the
   * instance doesn't exist (or doesn't belong to the requesting org)
   * and 500 if the definition is missing. Used by the sync route's
   * pre-flight + the redactor's `syncEligible` field.
   */
  static async resolveAdapter(
    connectorInstanceId: string,
    organizationId: string
  ): Promise<{
    instance: ConnectorInstanceSelect;
    slug: string;
    adapter: ConnectorAdapter;
  }> {
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
    const definition = await DbService.repository.connectorDefinitions.findById(
      instance.connectorDefinitionId
    );
    if (!definition) {
      throw new ApiError(
        500,
        ApiCode.CONNECTOR_DEFINITION_NOT_FOUND,
        "Connector definition not found"
      );
    }
    const adapter = ConnectorAdapterRegistry.get(definition.slug);
    return { instance, slug: definition.slug, adapter };
  }

  /**
   * The in-flight sync on a connector instance, or null (#769: any
   * non-terminal status, from the job lock model).
   */
  static async findActiveSyncJob(
    connectorInstanceId: string,
    organizationId: string
  ) {
    const running = await JobLockService.findRunning(
      [{ kind: "connectorInstance", id: connectorInstanceId }],
      organizationId
    );
    return (
      running.find(
        (j) =>
          j.type === CONNECTOR_SYNC_JOB_TYPE &&
          j.lockScopes.includes(`instance:${connectorInstanceId}`)
      ) ?? null
    );
  }

  /**
   * Throws 409 SYNC_ALREADY_RUNNING if another sync job for the given
   * instance is `pending` or `active`. The error includes the in-flight
   * jobId in `details` so the frontend can latch onto its SSE stream
   * instead of blocking the user.
   */
  static async assertNoActiveSyncJob(
    connectorInstanceId: string,
    organizationId: string
  ) {
    const existing = await SyncService.findActiveSyncJob(
      connectorInstanceId,
      organizationId
    );
    if (existing) {
      throw new ApiError(
        409,
        ApiCode.SYNC_ALREADY_RUNNING,
        `A sync is already running for this connector instance (job ${existing.id}).`,
        { jobId: existing.id }
      );
    }
  }

  /**
   * Pre-flight gate the sync route runs before enqueueing the job.
   * Resolves the adapter and refuses the sync when the connector type
   * doesn't support it (no `syncInstance`) or when the adapter's own
   * `assertSyncEligibility` says no (e.g. gsheets's rowPosition guard).
   *
   * Surfacing predictable refusals here keeps them out of the SSE event
   * stream — only runtime failures (Google API errors, refresh token
   * revoked, etc.) reach the job's error surface.
   */
  static async assertEligibleForSync(
    connectorInstanceId: string,
    organizationId: string
  ): Promise<{ instance: ConnectorInstanceSelect; slug: string }> {
    const { instance, slug, adapter } = await SyncService.resolveAdapter(
      connectorInstanceId,
      organizationId
    );
    if (!adapter.syncInstance) {
      throw new ApiError(
        400,
        ApiCode.SYNC_NOT_SUPPORTED,
        `Connector type "${slug}" does not support sync`
      );
    }
    if (adapter.assertSyncEligibility) {
      const eligibility = await adapter.assertSyncEligibility(instance);
      if (!eligibility.ok) {
        const code =
          (eligibility.reasonCode as ApiCode | undefined) ??
          ApiCode.SYNC_NOT_SUPPORTED;
        const status =
          eligibility.reasonCode === ApiCode.LAYOUT_PLAN_NOT_FOUND ? 404 : 409;
        throw new ApiError(
          status,
          code,
          eligibility.reason ?? "Sync not eligible for this instance",
          eligibility.details
        );
      }
    }
    return { instance, slug };
  }

  /**
   * Enqueue a `connector_sync` job for the given connector instance.
   * The processor resolves the appropriate adapter and dispatches the
   * pipeline.
   *
   * Caller is expected to have already run `assertEligibleForSync` and
   * `assertNoActiveSyncJob`. Returns the persisted job row.
   */
  static async enqueueSync(
    connectorInstanceId: string,
    organizationId: string,
    userId: string
  ) {
    const metadata: ConnectorSyncMetadata = {
      connectorInstanceId,
      organizationId,
      userId,
    };
    // #769: refused with 409 ENTITY_LOCKED_BY_JOB while any job holds the
    // connector or one of its entities.
    const job = await JobLockService.enqueueExclusive(userId, {
      type: CONNECTOR_SYNC_JOB_TYPE,
      organizationId,
      metadata: metadata as unknown as Record<string, unknown>,
    });
    logger.info(
      { connectorInstanceId, jobId: job.id },
      "connector_sync job enqueued"
    );
    return job;
  }
}
