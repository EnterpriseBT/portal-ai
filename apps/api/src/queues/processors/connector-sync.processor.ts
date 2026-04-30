import type { TypedJobProcessor } from "../jobs.worker.js";
import { ConnectorAdapterRegistry } from "../../adapters/adapter.registry.js";
import { DbService } from "../../services/db.service.js";
import { createLogger } from "../../utils/logger.util.js";

const logger = createLogger({ module: "connector-sync-processor" });

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
 *
 * See `docs/GOOGLE_SHEETS_CONNECTOR.phase-D.plan.md` §Slice 5.
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

  const result = await adapter.syncInstance(instance, userId, (percent) => {
    void bullJob.updateProgress(percent);
  });

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
