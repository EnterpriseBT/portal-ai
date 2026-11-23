import { useCallback } from "react";

import { useQueryClient } from "@tanstack/react-query";

import type { AssignedEntityTag } from "@portalai/core/contracts";
import type { TagTarget } from "@portalai/core/models";
import type { SelectOption } from "@portalai/core/ui";

import { queryKeys, sdk } from "../api/sdk";
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
  const queryClient = useQueryClient();
  const { mutateAsync: assign } = sdk.tagAssignments.assign(target);
  const { mutate: unassign } = sdk.tagAssignments.unassign(target);
  const { onSearch } = sdk.entityTags.search();
  const { canOnResource, capabilitiesKnown } = useCapabilities();

  const onAssign = useCallback(
    (entityTagId: string) => {
      assign(
        { entityTagId },
        {
          invalidate: tagAssignmentKeys(target.type),
          toast: { error: "Couldn't add the tag." },
        }
      ).catch((error: { code?: string }) => {
        // Adversarial walk (#1070): another tab or person added it first.
        // The toast says so; refetch so this page shows the tag it has.
        if (error?.code === "ENTITY_TAG_ASSIGNMENT_ALREADY_EXISTS") {
          void queryClient.invalidateQueries({
            queryKey: queryKeys.tagAssignments.listByTarget(
              target.type,
              target.id
            ),
          });
        }
      });
    },
    [assign, queryClient, target.type, target.id]
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
