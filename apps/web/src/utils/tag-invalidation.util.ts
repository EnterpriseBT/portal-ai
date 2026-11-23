import type { QueryKey } from "@tanstack/react-query";

import { TAG_TARGET_TYPES, type TagTargetType } from "@portalai/core/models";

import { queryKeys } from "../api/keys";
import { tagTargetListKey } from "../api/tag-assignments.api";

/**
 * What putting a tag on, or taking one off, an object makes stale (#1070):
 * its tag list, its type's lists (their rows carry tags), and the Tags
 * page's usage counts. Only the lists: the type's root also holds queries
 * a tag doesn't change (a pin's live data, a view's records), and refetching
 * those would re-run them. Pass it as the call's `invalidate` option (#985).
 */
export function tagAssignmentKeys(type: TagTargetType): QueryKey[] {
  return [
    queryKeys.tagAssignments.root,
    tagTargetListKey(type),
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
    ...TAG_TARGET_TYPES.map(tagTargetListKey),
  ];
}
