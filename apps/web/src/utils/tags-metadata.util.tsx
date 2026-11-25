import type { AssignedEntityTag } from "@portalai/core/contracts";
import type { MetadataItem } from "@portalai/core/ui";

import { TagsMetadataValueUI } from "../components/TagsMetadataValue.component";
import { decideActionGate } from "./action-gate.util";

export interface TagsMetadataItemInput {
  /** The object's tags; undefined while they load. */
  tags: AssignedEntityTag[] | undefined;
  /** The caller's write capability on the object (#1070). */
  canWrite: boolean;
  /** #630: whether the caller may read tags at all. */
  canReadTags: boolean;
  /** The object's name, for the Edit button. */
  name: string;
  onEdit: () => void;
}

/**
 * A detail page's "Tags" metadata row (#1115), appended last to its
 * MetadataList. Editing needs write on the object and a tag read (the
 * dialog's picker lists tags), so a writer who can't read tags gets no
 * Edit. Hidden while loading, without a tag read, and for a caller who
 * can't edit an object with no tags; a writer with none sees the row with
 * just its pencil, so Edit stays reachable.
 */
export function tagsMetadataItem({
  tags,
  canWrite,
  canReadTags,
  name,
  onEdit,
}: TagsMetadataItemInput): MetadataItem {
  const editGate = decideActionGate({ allowed: canWrite && canReadTags });
  const editable = editGate.kind !== "hide";
  return {
    label: "Tags",
    variant: "chip",
    hidden: !tags || !canReadTags || (!editable && tags.length === 0),
    value: (
      <TagsMetadataValueUI
        tags={tags ?? []}
        editGate={editGate}
        onEdit={onEdit}
        name={name}
      />
    ),
  };
}
