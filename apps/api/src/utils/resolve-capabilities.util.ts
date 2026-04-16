import type { EnabledCapabilityFlags } from "../db/schema/connector-instances.table.js";
import type { CapabilityFlags } from "../db/schema/connector-definitions.table.js";
import { connectorInstancesRepo } from "../db/repositories/connector-instances.repository.js";
import { connectorDefinitionsRepo } from "../db/repositories/connector-definitions.repository.js";
import { connectorEntitiesRepo } from "../db/repositories/connector-entities.repository.js";
import { stationInstancesRepo } from "../db/repositories/station-instances.repository.js";
import { ApiError } from "../services/http.service.js";
import { ApiCode } from "../constants/api-codes.constants.js";

export interface ResolvedCapabilities {
  read: boolean;
  write: boolean;
  push: boolean;
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
    read: (ceil.read ?? false) && (override?.read ?? true),
    write: (ceil.write ?? false) && (override?.write ?? true),
    push: (ceil.push ?? false) && (override?.push ?? true),
  };
}

/**
 * Assert that the connector instance owning a connector entity has write
 * capability enabled. Throws a 422 `CONNECTOR_INSTANCE_WRITE_DISABLED`
 * ApiError if writes are not permitted.
 *
 * `enabledCapabilityFlags` is the source of truth — the definition
 * constrains what *can* be enabled, but the instance flags record what
 * *is* enabled.
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

  if (instance.enabledCapabilityFlags?.write !== true) {
    throw new ApiError(
      422,
      ApiCode.CONNECTOR_INSTANCE_WRITE_DISABLED,
      "Cannot perform write operation — the connector instance does not have write capability enabled.",
    );
  }
}

// ── Station-level capability helpers ─────────────────────────────────

export interface StationInstanceCapability {
  connectorInstanceId: string;
  capabilities: ResolvedCapabilities;
}

/**
 * Resolve capabilities for every connector instance attached to a station.
 * Returns one entry per station-instance link with the merged capability flags.
 */
export async function resolveStationCapabilities(
  stationId: string,
): Promise<StationInstanceCapability[]> {
  const stationLinks = await stationInstancesRepo.findByStationId(
    stationId,
    { include: ["connectorInstance"] },
  );

  if (stationLinks.length === 0) return [];

  const instanceIds = [
    ...new Set(stationLinks.map((l) => l.connectorInstanceId)),
  ];

  // Load definitions for all instances
  const instances = await Promise.all(
    instanceIds.map((id) => connectorInstancesRepo.findById(id)),
  );
  const instanceMap = new Map(
    instances.filter(Boolean).map((i) => [i!.id, i!]),
  );

  const definitionIds = [
    ...new Set(
      instances
        .filter(Boolean)
        .map((i) => i!.connectorDefinitionId),
    ),
  ];
  const definitions = await Promise.all(
    definitionIds.map((id) => connectorDefinitionsRepo.findById(id)),
  );
  const definitionMap = new Map(
    definitions.filter(Boolean).map((d) => [d!.id, d!]),
  );

  const result: StationInstanceCapability[] = [];

  for (const link of stationLinks) {
    const instance = instanceMap.get(link.connectorInstanceId);
    if (!instance) continue;

    const definition = definitionMap.get(instance.connectorDefinitionId);
    if (!definition) continue;

    result.push({
      connectorInstanceId: link.connectorInstanceId,
      capabilities: resolveCapabilities(definition, instance),
    });
  }

  return result;
}

/**
 * Assert that a connector entity belongs to a connector instance that is
 * attached to the given station. Throws if the entity does not exist or
 * its instance is not linked to the station.
 */
export async function assertStationScope(
  stationId: string,
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

  const stationLinks = await stationInstancesRepo.findByStationId(stationId);
  const attachedInstanceIds = new Set(
    stationLinks.map((l) => l.connectorInstanceId),
  );

  if (!attachedInstanceIds.has(entity.connectorInstanceId)) {
    throw new ApiError(
      403,
      ApiCode.STATION_SCOPE_VIOLATION,
      "Connector entity does not belong to an instance attached to this station.",
    );
  }
}

/**
 * Build a map of entity ID → resolved capabilities for all entities
 * reachable from a station's attached connector instances.
 */
export async function resolveEntityCapabilities(
  stationId: string,
): Promise<Record<string, ResolvedCapabilities>> {
  const stationCaps = await resolveStationCapabilities(stationId);
  if (stationCaps.length === 0) return {};

  const capsByInstance = new Map(
    stationCaps.map((sc) => [sc.connectorInstanceId, sc.capabilities]),
  );

  // Load all entities for the attached instances
  const entities = (
    await Promise.all(
      stationCaps.map((sc) =>
        connectorEntitiesRepo.findByConnectorInstanceId(
          sc.connectorInstanceId,
        ),
      ),
    )
  ).flat();

  const result: Record<string, ResolvedCapabilities> = {};
  for (const entity of entities) {
    const caps = capsByInstance.get(entity.connectorInstanceId);
    if (caps) {
      result[entity.id] = caps;
    }
  }

  return result;
}
