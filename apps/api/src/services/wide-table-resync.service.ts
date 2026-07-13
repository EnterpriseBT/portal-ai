/**
 * One-shot re-sync trigger run after Phase 2's destructive migration.
 *
 * Iterates every live `connector_instances` row and enqueues a
 * `connector_sync` job per instance via `SyncService.enqueueSync`.
 * The existing BullMQ processor (`connectorSyncProcessor`) resolves the
 * adapter and runs its `syncInstance` pipeline, which dual-writes
 * `entity_records` + `er__<id>` via the slice-2 wiring.
 *
 * The trigger is idempotent — re-running picks up any instance that
 * no longer has an active sync job and re-enqueues it. Instances with
 * an in-flight sync are reported under `skippedInFlight`; instances
 * whose adapter doesn't implement `syncInstance` (the sandbox connector,
 * for example) land in `skippedUnsupported`.
 */

import { isNull } from "drizzle-orm";

import { DbService } from "./db.service.js";
import { SyncService } from "./sync.service.js";
import { ConnectorAdapterRegistry } from "../adapters/adapter.registry.js";
import { createLogger } from "../utils/logger.util.js";
import { connectorInstances } from "../db/schema/index.js";

const logger = createLogger({ module: "wide-table-resync" });

export interface ResyncReport {
  /** Job ids freshly enqueued via `SyncService.enqueueSync`. */
  triggered: string[];
  /** Instance ids whose sync was already running. */
  skippedInFlight: string[];
  /** Instance ids whose adapter does not implement `syncInstance`. */
  skippedUnsupported: string[];
  /** Per-instance enqueue failures. */
  failed: Array<{ instanceId: string; error: string }>;
}

export const wideTableResyncService = {
  /**
   * Fan out a sync job to every live connector instance.
   *
   * `actorUserId` is attributed as `createdBy` on every enqueued job —
   * pass the admin user calling the trigger so audit logs point at the
   * operator, not a synthetic system user.
   */
  async resyncAllConnectorInstances(
    actorUserId: string
  ): Promise<ResyncReport> {
    const instances = await DbService.repository.connectorInstances.findMany(
      isNull(connectorInstances.deleted)
    );

    const triggered: string[] = [];
    const skippedInFlight: string[] = [];
    const skippedUnsupported: string[] = [];
    const failed: Array<{ instanceId: string; error: string }> = [];

    for (const inst of instances) {
      try {
        const def = await DbService.repository.connectorDefinitions.findById(
          inst.connectorDefinitionId
        );
        if (!def) {
          failed.push({
            instanceId: inst.id,
            error: `connector definition ${inst.connectorDefinitionId} not found`,
          });
          continue;
        }
        const adapter = ConnectorAdapterRegistry.get(def.slug);
        if (!adapter.syncInstance) {
          skippedUnsupported.push(inst.id);
          continue;
        }
        const active = await SyncService.findActiveSyncJob(inst.id);
        if (active) {
          skippedInFlight.push(inst.id);
          continue;
        }
        const job = await SyncService.enqueueSync(
          inst.id,
          inst.organizationId,
          actorUserId
        );
        triggered.push(job.id);
      } catch (err) {
        failed.push({
          instanceId: inst.id,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    logger.info(
      {
        instances: instances.length,
        triggered: triggered.length,
        skippedInFlight: skippedInFlight.length,
        skippedUnsupported: skippedUnsupported.length,
        failed: failed.length,
        actorUserId,
      },
      "wide_table_resync trigger fan-out complete"
    );

    return { triggered, skippedInFlight, skippedUnsupported, failed };
  },
};
