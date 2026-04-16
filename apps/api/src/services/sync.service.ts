/**
 * Sync service for triggering connector adapter syncs.
 *
 * Orchestrates the entity → instance → definition → adapter chain
 * and updates `lastSyncAt` after a successful sync.
 */

import type { SyncResult } from "../adapters/adapter.interface.js";
import { ConnectorAdapterRegistry } from "../adapters/adapter.registry.js";
import { DbService } from "./db.service.js";
import { createLogger } from "../utils/logger.util.js";

const logger = createLogger({ module: "sync-service" });

export class SyncService {
  /**
   * Sync a connector entity by loading the adapter chain and delegating.
   *
   * 1. Load entity → instance → definition → adapter
   * 2. Call `adapter.syncEntity(instance, entityKey)`
   * 3. Update `connectorInstance.lastSyncAt`
   * 4. Return `{ created, updated, unchanged, errors }`
   *
   * @throws Error if entity, instance, definition, or adapter is not found
   */
  static async syncEntity(
    connectorEntityId: string,
    userId: string
  ): Promise<SyncResult> {
    // 1. Load entity
    const entity =
      await DbService.repository.connectorEntities.findById(
        connectorEntityId
      );
    if (!entity) {
      throw new Error(
        `Connector entity not found: ${connectorEntityId}`
      );
    }

    // 2. Load instance
    const instance =
      await DbService.repository.connectorInstances.findById(
        entity.connectorInstanceId
      );
    if (!instance) {
      throw new Error(
        `Connector instance not found: ${entity.connectorInstanceId}`
      );
    }

    // 3. Load definition
    const definition =
      await DbService.repository.connectorDefinitions.findById(
        instance.connectorDefinitionId
      );
    if (!definition) {
      throw new Error(
        `Connector definition not found: ${instance.connectorDefinitionId}`
      );
    }

    // 4. Get adapter
    const adapter = ConnectorAdapterRegistry.get(definition.slug);

    // 5. Execute sync
    logger.info(
      { connectorEntityId, slug: definition.slug },
      "Starting entity sync"
    );

    const result = await adapter.syncEntity(instance, entity.key);

    // 6. Update lastSyncAt
    await DbService.repository.connectorInstances.update(instance.id, {
      lastSyncAt: Date.now(),
      updatedBy: userId,
    });

    logger.info(
      { connectorEntityId, slug: definition.slug, result },
      "Entity sync completed"
    );

    return result;
  }
}
