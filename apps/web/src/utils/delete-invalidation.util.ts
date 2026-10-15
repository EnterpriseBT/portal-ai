import type { QueryClient } from "@tanstack/react-query";

import { queryKeys } from "../api/keys";

/**
 * What a successful connector-instance delete makes stale. The API soft-deletes
 * the instance and its entities, mappings, records, tags and group members,
 * unlinks it from its stations, and deletes the curated views over its
 * entities, detaching those from their stations too (#802).
 */
export function invalidateAfterConnectorInstanceDelete(
  queryClient: QueryClient
): void {
  for (const queryKey of [
    queryKeys.connectorInstances.root,
    queryKeys.connectorEntities.root,
    queryKeys.fieldMappings.root,
    queryKeys.stations.root,
    queryKeys.curatedViews.root,
  ]) {
    queryClient.invalidateQueries({ queryKey });
  }
}

/**
 * What a successful entity delete makes stale: the entity and everything that
 * cascades from it, including its curated views and their station
 * attachments (#802).
 */
export function invalidateAfterConnectorEntityDelete(
  queryClient: QueryClient
): void {
  for (const queryKey of [
    queryKeys.connectorEntities.root,
    queryKeys.entityRecords.root,
    queryKeys.fieldMappings.root,
    queryKeys.entityGroups.root,
    queryKeys.stations.root,
    queryKeys.curatedViews.root,
  ]) {
    queryClient.invalidateQueries({ queryKey });
  }
}
