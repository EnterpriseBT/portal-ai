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
    // #1070: the deleted objects' tags, and the Tags page's usage counts.
    queryKeys.tagAssignments.root,
    queryKeys.entityTags.root,
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
    // #1070: the deleted objects' tags, and the Tags page's usage counts.
    queryKeys.tagAssignments.root,
    queryKeys.entityTags.root,
  ];
}

/**
 * What a successful station delete makes stale (#1041):
 * - the station;
 * - its portals, which are deleted with it;
 * - pinned results, which are kept but lose their link to those portals;
 * - connector instances, which the delete unlinks from the station (a
 *   connector's delete dialog counts the stations it would unlink);
 * - the organization, whose default station is cleared when it was this one.
 *   Without it the app keeps the old `defaultStationId` and asks for a
 *   station that is gone.
 *
 * Pass it as the call's `invalidate` option (#985).
 */
export function stationDeleteKeys(): QueryKey[] {
  return [
    queryKeys.stations.root,
    queryKeys.portals.root,
    queryKeys.portalResults.root,
    queryKeys.connectorInstances.root,
    queryKeys.organizations.root,
    // #1070: the deleted objects' tags, and the Tags page's usage counts.
    queryKeys.tagAssignments.root,
    queryKeys.entityTags.root,
  ];
}

/**
 * What a successful pin delete (or unpin) makes stale (#1070): the pins,
 * and the pin's tags, which the delete removes, with the Tags page's usage
 * counts. After `await mutateAsync`, invalidate each key.
 */
export function pinDeleteKeys(): QueryKey[] {
  return [
    queryKeys.portalResults.root,
    queryKeys.tagAssignments.root,
    queryKeys.entityTags.root,
  ];
}

/**
 * What a successful view delete makes stale (#1070): the views, and the
 * view's tags, which the delete removes, with the Tags page's usage counts.
 * Pass it as the call's `invalidate` option (#985).
 */
export function curatedViewDeleteKeys(): QueryKey[] {
  return [
    queryKeys.curatedViews.root,
    queryKeys.tagAssignments.root,
    queryKeys.entityTags.root,
  ];
}
