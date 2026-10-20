import type { EnabledCapabilityFlags } from "../db/schema/connector-instances.table.js";
import type { CapabilityFlags } from "../db/schema/connector-definitions.table.js";
import { connectorInstancesRepo } from "../db/repositories/connector-instances.repository.js";
import { connectorDefinitionsRepo } from "../db/repositories/connector-definitions.repository.js";
import { connectorEntitiesRepo } from "../db/repositories/connector-entities.repository.js";
import { stationInstancesRepo } from "../db/repositories/station-instances.repository.js";
import { stationViewsRepo } from "../db/repositories/station-views.repository.js";
import { curatedViewsRepo } from "../db/repositories/curated-views.repository.js";
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
  instance: { enabledCapabilityFlags: EnabledCapabilityFlags | null }
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
  connectorEntityId: string
): Promise<void> {
  const entity = await connectorEntitiesRepo.findById(connectorEntityId);
  if (!entity) {
    throw new ApiError(
      404,
      ApiCode.CONNECTOR_ENTITY_NOT_FOUND,
      "Connector entity not found."
    );
  }

  const instance = await connectorInstancesRepo.findById(
    entity.connectorInstanceId
  );
  if (!instance) {
    throw new ApiError(
      404,
      ApiCode.CONNECTOR_INSTANCE_NOT_FOUND,
      "Connector instance not found."
    );
  }

  if (instance.enabledCapabilityFlags?.write !== true) {
    throw new ApiError(
      422,
      ApiCode.CONNECTOR_INSTANCE_WRITE_DISABLED,
      "Cannot perform write operation — the connector instance does not have write capability enabled."
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
  stationId: string
): Promise<StationInstanceCapability[]> {
  // #599 / #824 / #827: the station's reach — its direct connectors and the
  // connectors behind its views — is the one definition the write gate and
  // the write tools' per-item scope checks share.
  const { instanceIds } = await stationReach(stationId);
  if (instanceIds.length === 0) return [];

  // Load definitions for all instances
  const instances = await Promise.all(
    instanceIds.map((id) => connectorInstancesRepo.findById(id))
  );
  const instanceMap = new Map(
    instances.filter(Boolean).map((i) => [i!.id, i!])
  );

  const definitionIds = [
    ...new Set(instances.filter(Boolean).map((i) => i!.connectorDefinitionId)),
  ];
  const definitions = await Promise.all(
    definitionIds.map((id) => connectorDefinitionsRepo.findById(id))
  );
  const definitionMap = new Map(
    definitions.filter(Boolean).map((d) => [d!.id, d!])
  );

  const result: StationInstanceCapability[] = [];

  for (const instanceId of instanceIds) {
    const instance = instanceMap.get(instanceId);
    if (!instance) continue;

    const definition = definitionMap.get(instance.connectorDefinitionId);
    if (!definition) continue;

    result.push({
      connectorInstanceId: instanceId,
      capabilities: resolveCapabilities(definition, instance),
    });
  }

  return result;
}

/**
 * #827: what a station reaches.
 * - `directInstanceIds`: connectors attached to the station directly
 *   (`station_instances`).
 * - `entityIds`: entities behind the station's live curated views (#599).
 * - `instanceIds`: both kinds of connector, the direct ones and those behind
 *   a view. This is what the write gate (`resolveStationCapabilities`) offers
 *   tools for, and where the agent may create an entity.
 *
 * An existing entity is in reach when its connector is attached directly or
 * it is itself behind a view (`assertStationScope`). A view on one entity
 * doesn't put that connector's other entities in reach. Reach isn't
 * permission: every write is still authorized per call by the permission
 * gate (#829).
 */
export async function stationReach(stationId: string): Promise<{
  instanceIds: string[];
  directInstanceIds: string[];
  entityIds: string[];
}> {
  const [viewed, links] = await Promise.all([
    stationViewsRepo.findReachByStationId(stationId),
    stationInstancesRepo.findByStationId(stationId),
  ]);
  const directInstanceIds = [
    ...new Set(links.map((l) => l.connectorInstanceId)),
  ];
  return {
    directInstanceIds,
    entityIds: [...new Set(viewed.map((v) => v.connectorEntityId))],
    instanceIds: [
      ...new Set([
        ...directInstanceIds,
        ...viewed.map((v) => v.connectorInstanceId),
      ]),
    ],
  };
}

/**
 * The connector-entity ids in scope for a station — the entities behind the
 * station's attached curated views (#599). Dedup'd. The single source both
 * capability resolvers derive from, replacing the `station_instances` fan-out.
 */
async function entityIdsForStation(stationId: string): Promise<string[]> {
  const attachments = await stationViewsRepo.findByStationId(stationId);
  if (attachments.length === 0) return [];
  const viewIds = [...new Set(attachments.map((a) => a.curatedViewId))];
  const views = await Promise.all(
    viewIds.map((id) => curatedViewsRepo.findById(id))
  );
  return [...new Set(views.filter(Boolean).map((v) => v!.connectorEntityId))];
}

/**
 * Assert that a connector entity is within the station's reach
 * ({@link stationReach}): its connector is attached directly, or the entity
 * itself is behind one of the station's views. Throws if the entity does not
 * exist or the station doesn't reach it. Two queries, whatever the station's
 * size.
 */
export async function assertStationScope(
  stationId: string,
  connectorEntityId: string
): Promise<void> {
  const entity = await connectorEntitiesRepo.findById(connectorEntityId);
  if (!entity) {
    throw new ApiError(
      404,
      ApiCode.CONNECTOR_ENTITY_NOT_FOUND,
      "Connector entity not found."
    );
  }

  const reach = await stationReach(stationId);
  if (
    !reach.directInstanceIds.includes(entity.connectorInstanceId) &&
    !reach.entityIds.includes(entity.id)
  ) {
    throw new ApiError(
      403,
      ApiCode.STATION_SCOPE_VIOLATION,
      "Connector entity does not belong to an instance attached to this station."
    );
  }
}

/**
 * Build a map of entity ID → resolved capabilities for all entities
 * reachable from a station's attached connector instances.
 */
export async function resolveEntityCapabilities(
  stationId: string
): Promise<Record<string, ResolvedCapabilities>> {
  // #599: only the entities behind the station's attached curated views are in
  // scope (not every entity of an attached instance) — capability still comes
  // from the entity's instance.
  const entityIds = await entityIdsForStation(stationId);
  if (entityIds.length === 0) return {};

  const stationCaps = await resolveStationCapabilities(stationId);
  const capsByInstance = new Map(
    stationCaps.map((sc) => [sc.connectorInstanceId, sc.capabilities])
  );

  const entities = (
    await Promise.all(entityIds.map((id) => connectorEntitiesRepo.findById(id)))
  ).filter(Boolean);

  const result: Record<string, ResolvedCapabilities> = {};
  for (const entity of entities) {
    const caps = capsByInstance.get(entity!.connectorInstanceId);
    if (caps) {
      result[entity!.id] = caps;
    }
  }

  return result;
}
