import { useCallback, useState } from "react";

import type { TagTarget } from "@portalai/core/models";
import type { MetadataItem } from "@portalai/core/ui";

import type { TagsDialogUIProps } from "../components/TagsDialog.component";
import { tagsMetadataItem } from "./tags-metadata.util";
import { useTagAssignments } from "./use-tag-assignments.util";

export interface ObjectTagsHandle {
  /** The "Tags" row, to append last to the page's MetadataList. */
  metadataItem: (object: { canWrite: boolean; name: string }) => MetadataItem;
  /** Props for `<TagsDialogUI />`. */
  dialogProps: (name: string) => TagsDialogUIProps;
}

/**
 * A detail page's tags (#1115): the metadata row and the Edit dialog, wired
 * to the object's tag assignments. The hook runs at the view's top level
 * with the route's id; both builders take what only the loaded object knows
 * (its name and write capability), so a page can call them inside its
 * data-render callback. Each change rides useTagAssignments' calls, with
 * their toasts and refreshes (#970).
 */
export function useObjectTags(target: TagTarget): ObjectTagsHandle {
  const handle = useTagAssignments(target);
  const [open, setOpen] = useState(false);
  const onEdit = useCallback(() => setOpen(true), []);
  const onClose = useCallback(() => setOpen(false), []);

  return {
    metadataItem: ({ canWrite, name }) =>
      tagsMetadataItem({
        tags: handle.tags,
        canWrite,
        canReadTags: handle.canReadTags,
        name,
        onEdit,
      }),
    dialogProps: (name) => ({
      open,
      onClose,
      name,
      tags: handle.tags ?? [],
      onAssign: handle.onAssign,
      onUnassign: handle.onUnassign,
      onSearch: handle.onSearch,
      canReadTags: handle.canReadTags,
    }),
  };
}
