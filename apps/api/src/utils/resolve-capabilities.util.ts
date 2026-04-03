import type { EnabledCapabilityFlags } from "../db/schema/connector-instances.table.js";
import type { CapabilityFlags } from "../db/schema/connector-definitions.table.js";
import { connectorInstancesRepo } from "../db/repositories/connector-instances.repository.js";
import { connectorDefinitionsRepo } from "../db/repositories/connector-definitions.repository.js";
import { connectorEntitiesRepo } from "../db/repositories/connector-entities.repository.js";
import { ApiError } from "../services/http.service.js";
import { ApiCode } from "../constants/api-codes.constants.js";

export interface ResolvedCapabilities {
  read: boolean;
  write: boolean;
}

/**
 * Resolve the effective capabilities for a connector instance by merging the
 * definition's capability ceiling with the instance's overrides.
 *
 * - The definition's `capabilityFlags` represent the ceiling (what the connector *can* do).
 * - The instance's `enabledCapabilityFlags` narrow that ceiling (what the instance *is allowed* to do).
 * - If `enabledCapabilityFlags` is null, the instance inherits all definition capabilities.
 */
export function resolveCapabilities(
  definition: { capabilityFlags: CapabilityFlags },
  instance: { enabledCapabilityFlags: EnabledCapabilityFlags | null },
): ResolvedCapabilities {
  const ceil = definition.capabilityFlags;
  const override = instance.enabledCapabilityFlags;

  return {
    read: (ceil.query ?? false) && (override?.read ?? true),
    write: (ceil.write ?? false) && (override?.write ?? true),
  };
}

/**
 * Assert that the connector instance owning a connector entity has write
 * capability. Throws a 422 `CONNECTOR_INSTANCE_WRITE_DISABLED` ApiError
 * if writes are not permitted.
 *
 * Resolves the chain: connectorEntityId → connectorInstance → connectorDefinition.
 */
export async function assertWriteCapability(
  connectorEntityId: string,
): Promise<void> {
  const entity = await connectorEntitiesRepo.findById(connectorEntityId);
  if (!entity) {
    throw new ApiError(
      404,
      ApiCode.CONNECTOR_ENTITY_NOT_FOUND,
      "Connector entity not found.",
    );
  }

  const instance = await connectorInstancesRepo.findById(
    entity.connectorInstanceId,
  );
  if (!instance) {
    throw new ApiError(
      404,
      ApiCode.CONNECTOR_INSTANCE_NOT_FOUND,
      "Connector instance not found.",
    );
  }

  const definition = await connectorDefinitionsRepo.findById(
    instance.connectorDefinitionId,
  );
  if (!definition) {
    throw new ApiError(
      404,
      ApiCode.CONNECTOR_DEFINITION_NOT_FOUND,
      "Connector definition not found.",
    );
  }

  const capabilities = resolveCapabilities(definition, instance);

  if (!capabilities.write) {
    throw new ApiError(
      422,
      ApiCode.CONNECTOR_INSTANCE_WRITE_DISABLED,
      "Cannot perform write operation — the connector instance does not have write capability enabled.",
    );
  }
}
