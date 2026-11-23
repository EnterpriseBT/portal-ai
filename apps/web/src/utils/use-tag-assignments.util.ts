import { useCallback } from "react";

import type { AssignedEntityTag } from "@portalai/core/contracts";
import type { TagTarget } from "@portalai/core/models";
import type { SelectOption } from "@portalai/core/ui";

import { sdk } from "../api/sdk";
import { tagAssignmentKeys } from "./tag-invalidation.util";
import { useCapabilities } from "./use-capabilities.util";

export interface TagAssignmentsHandle {
  /** The object's readable tags; undefined while loading. */
  tags: AssignedEntityTag[] | undefined;
  onAssign: (entityTagId: string) => void;
  onUnassign: (assignmentId: string) => void;
  onSearch: (query: string) => Promise<SelectOption[]>;
  /** #630: whether the caller may read tags at all. */
  canReadTags: boolean;
}

/**
 * The tags on one object and the calls that change them (#1070), for any
 * taggable type. A failure raises a toast; the refresh rides the call's
 * `invalidate`, so it lands even when the page has gone (#985).
 */
export function useTagAssignments(target: TagTarget): TagAssignmentsHandle {
  const list = sdk.tagAssignments.list(target);
  const { mutate: assign } = sdk.tagAssignments.assign(target);
  const { mutate: unassign } = sdk.tagAssignments.unassign(target);
  const { onSearch } = sdk.entityTags.search();
  const { canOnResource, capabilitiesKnown } = useCapabilities();

  const onAssign = useCallback(
    (entityTagId: string) =>
      assign(
        { entityTagId },
        {
          invalidate: tagAssignmentKeys(target.type),
          toast: { error: "Couldn't add the tag." },
        }
      ),
    [assign, target.type]
  );

  const onUnassign = useCallback(
    (assignmentId: string) =>
      unassign(
        { assignmentId },
        {
          invalidate: tagAssignmentKeys(target.type),
          toast: { error: "Couldn't remove the tag." },
        }
      ),
    [unassign, target.type]
  );

  return {
    tags: list.data?.tags,
    onAssign,
    onUnassign,
    onSearch,
    // #630: optimistic while the current-org query loads.
    canReadTags: !capabilitiesKnown || canOnResource("tag", "read"),
  };
}
