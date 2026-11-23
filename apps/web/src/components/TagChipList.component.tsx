import React from "react";

import { Stack } from "@portalai/core/ui";

import { TagChipUI } from "./TagChip.component";

interface ListedTag {
  id: string;
  name: string;
  color: string | null;
}

export interface TagChipListUIProps<T extends ListedTag = ListedTag> {
  tags: T[] | undefined;
  /** Makes each chip removable. */
  onDelete?: (tag: T) => void;
}

/**
 * An object's tags as a wrapping row of chips (#1070). Renders nothing when
 * there are none, so a card or section with no tags shows no tag row.
 */
export function TagChipListUI<T extends ListedTag>({
  tags,
  onDelete,
}: TagChipListUIProps<T>): React.ReactElement | null {
  if (!tags || tags.length === 0) return null;
  return (
    <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
      {tags.map((tag) => (
        <TagChipUI
          key={tag.id}
          tag={tag}
          onDelete={onDelete ? () => onDelete(tag) : undefined}
        />
      ))}
    </Stack>
  );
}
