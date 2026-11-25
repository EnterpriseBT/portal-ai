import React from "react";

import type { AssignedEntityTag } from "@portalai/core/contracts";
import { GatedButton, Stack, Typography } from "@portalai/core/ui";
import type { ActionGate } from "@portalai/core/ui";

import { TagChipListUI } from "./TagChipList.component";

export interface TagsMetadataValueUIProps {
  tags: AssignedEntityTag[];
  /** The Edit button's gate. `hide` leaves the row read-only. */
  editGate: ActionGate;
  onEdit: () => void;
  /** The object's name, for the Edit button's accessible name. */
  name: string;
}

/**
 * A detail page's Tags metadata value (#1115): the object's tags as
 * read-only chips, or "No tags", then an Edit button that opens the tag
 * dialog. Editing happens in the dialog, so the chips here never remove.
 */
export const TagsMetadataValueUI: React.FC<TagsMetadataValueUIProps> = ({
  tags,
  editGate,
  onEdit,
  name,
}) => (
  <Stack
    direction="row"
    spacing={1}
    alignItems="center"
    flexWrap="wrap"
    useFlexGap
  >
    {tags.length > 0 ? (
      <TagChipListUI tags={tags} />
    ) : (
      <Typography variant="body2" color="text.secondary">
        No tags
      </Typography>
    )}
    {editGate.kind !== "hide" && (
      <GatedButton
        gate={editGate}
        type="button"
        size="small"
        onClick={onEdit}
        aria-label={`Edit tags for ${name}`}
      >
        Edit
      </GatedButton>
    )}
  </Stack>
);
