import type { QueryKey } from "@tanstack/react-query";

import { queryKeys } from "../api/keys";

/**
 * What a successful connector-instance delete makes stale. The API soft-deletes
 * the instance and its entities, mappings, records, tags and group members,
 * unlinks it from its stations, and deletes the curated views over its
 * entities, detaching those from their stations too (#802).
 *
 * Pass it as the delete call's `invalidate` option (#985), which still runs
 * when the page unmounts before the request settles.
 */
export function connectorInstanceDeleteKeys(): QueryKey[] {
  return [
    queryKeys.connectorInstances.root,
    queryKeys.connectorEntities.root,
    queryKeys.fieldMappings.root,
    queryKeys.stations.root,
    queryKeys.curatedViews.root,
  ];
}

/**
 * What a successful entity delete makes stale: the entity and everything that
 * cascades from it, including its curated views and their station
 * attachments (#802). Pass it as the call's `invalidate` option (#985).
 */
export function connectorEntityDeleteKeys(): QueryKey[] {
  return [
    queryKeys.connectorEntities.root,
    queryKeys.entityRecords.root,
    queryKeys.fieldMappings.root,
    queryKeys.entityGroups.root,
    queryKeys.stations.root,
    queryKeys.curatedViews.root,
  ];
}
