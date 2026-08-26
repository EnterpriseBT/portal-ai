import type { TypedJobProcessor } from "../jobs.worker.js";
import { ConnectorAdapterRegistry } from "../../adapters/adapter.registry.js";
import { DbService } from "../../services/db.service.js";
import { SyncLockService } from "../../services/sync-lock.service.js";
import { createLogger } from "../../utils/logger.util.js";

const logger = createLogger({ module: "connector-sync-processor" });

/**
 * Best-effort identity of whoever holds the instance's sync lock (#460).
 *
 * `pg_try_advisory_lock` does not report its holder, so this infers it from
 * the other non-terminal job on the same instance. Deliberately best-effort:
 * a holder can exist without a distinguishable job row (a direct invocation,
 * or a row already transitioned), and a failed lookup must never turn a
 * correctly-skipped pass into a failed job. Returns `undefined` rather than
 * guessing, and the field is then omitted from the result.
 */
async function identifyHolder(
  connectorInstanceId: string,
  organizationId: string,
  selfJobId: string
): Promise<string | undefined> {
  try {
    const running =
      await DbService.repository.jobs.findRunningForConnectorInstance(
        connectorInstanceId,
        organizationId
      );
    return running.find((j) => j.id !== selfJobId)?.id;
  } catch (err) {
    logger.warn(
      { event: "connector-sync.superseded-holder-lookup-failed", err },
      "Could not identify the sync lock holder; reporting superseded without it"
    );
    return undefined;
  }
}

/**
 * Processor for `connector_sync` jobs.
 *
 * Connector-agnostic: resolves the appropriate adapter via the
 * connector instance's definition slug and delegates to its
 * `syncInstance` method. The adapter owns the actual pipeline (e.g.
 * gsheets's load-plan → fetch-workbook → replay → watermark-reap → mark
 * lastSyncAt; future SQL adapters would do their own thing entirely).
 * The adapter reports progress through the supplied callback; this
 * processor forwards each tick to BullMQ so SSE consumers see live
 * progress.
 */
export const connectorSyncProcessor: TypedJobProcessor<
  "connector_sync"
> = async (bullJob) => {
  const { jobId, connectorInstanceId, userId } = bullJob.data;

  logger.info({ jobId, connectorInstanceId }, "connector_sync started");

  const instance =
    await DbService.repository.connectorInstances.findById(connectorInstanceId);
  if (!instance) {
    throw new Error(`Connector instance not found: ${connectorInstanceId}`);
  }

  const definition = await DbService.repository.connectorDefinitions.findById(
    instance.connectorDefinitionId
  );
  if (!definition) {
    throw new Error(
      `Connector definition not found: ${instance.connectorDefinitionId}`
    );
  }

  const adapter = ConnectorAdapterRegistry.get(definition.slug);
  if (!adapter.syncInstance) {
    throw new Error(
      `Adapter ${definition.slug} does not implement syncInstance`
    );
  }

  // #460: two passes of ONE job can run at once — BullMQ re-delivers a job
  // whose lock expired without incrementing `attemptsMade`, so the entity lock
  // (keyed on the job row) does not see it. Both passes then reap by their own
  // watermark, and the later one deletes the earlier one's in-flight writes:
  // measured at 34,000 records lost from a 397,960-record layer, on a job
  // reporting `completed`. The lock is taken here rather than inside the
  // adapters because this is the single call site for all three of them.
  const outcome = await SyncLockService.withInstanceLock(
    connectorInstanceId,
    () =>
      adapter.syncInstance!(instance, userId, {
        progress: (percent) => {
          void bullJob.updateProgress(percent);
        },
        // #439: BullMQ attempts of one sync must share a record-identity
        // generation. Without this the adapter falls back to a per-run value
        // and a retry inserts a second full copy of the dataset.
        jobId,
      })
  );

  if (!outcome.acquired) {
    const supersededBy = await identifyHolder(
      connectorInstanceId,
      instance.organizationId,
      jobId
    );
    logger.warn(
      {
        event: "connector-sync.superseded",
        jobId,
        connectorInstanceId,
        supersededBy,
      },
      "Another pass holds this instance's sync lock — skipped without reaping"
    );
    // NOT a failure (#441): nothing went wrong, this pass simply had no work
    // to do. Throwing would have BullMQ retry it into the same wall.
    return {
      recordCounts: { created: 0, updated: 0, unchanged: 0, deleted: 0 },
      superseded: true,
      ...(supersededBy ? { supersededBy } : {}),
    };
  }

  const result = outcome.value;

  logger.info(
    {
      jobId,
      connectorInstanceId,
      slug: definition.slug,
      recordCounts: result.recordCounts,
    },
    "connector_sync completed"
  );

  return result;
};
