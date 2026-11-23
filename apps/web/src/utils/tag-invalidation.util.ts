import type { QueryKey } from "@tanstack/react-query";

import type { TagTargetType } from "@portalai/core/models";

import { queryKeys } from "../api/keys";
import { tagTargetRootKey } from "../api/tag-assignments.api";

/**
 * What putting a tag on, or taking one off, an object makes stale (#1070):
 * its tag list, its type's lists and detail (their rows carry tags), and the
 * Tags page's usage counts. Pass it as the call's `invalidate` option (#985).
 */
export function tagAssignmentKeys(type: TagTargetType): QueryKey[] {
  return [
    queryKeys.tagAssignments.root,
    tagTargetRootKey(type),
    queryKeys.entityTags.root,
  ];
}

/**
 * What renaming, recolouring or deleting a tag makes stale (#1070): the
 * catalog, every object's tag list, and the lists of every taggable type,
 * whose rows carry tags. A deleted tag comes off every object.
 */
export function tagCatalogChangeKeys(): QueryKey[] {
  return [
    queryKeys.entityTags.root,
    queryKeys.tagAssignments.root,
    queryKeys.connectorEntities.root,
    queryKeys.stations.root,
    queryKeys.portalResults.root,
    queryKeys.connectorInstances.root,
    queryKeys.curatedViews.root,
  ];
}
