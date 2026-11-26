import React from "react";

import { Box, EmptyState, Icon, IconName, Stack } from "@portalai/core/ui";

import {
  TagCountChipUI,
  type TagCountChipUIProps,
} from "./TagCountChip.component";
import { emptyListHelp } from "../utils/empty-list-help.util";

export interface BrowseByTagUIProps {
  /** In the order to show them. */
  tags: TagCountChipUIProps[];
}

/**
 * The dashboard's Browse by tag (#1123): each tag as a link with its count,
 * or a teaching empty state when the org has no tags.
 */
export const BrowseByTagUI: React.FC<BrowseByTagUIProps> = ({ tags }) => {
  if (tags.length === 0) {
    return (
      <EmptyState
        icon={<Icon name={IconName.Label} />}
        title="No tags yet"
        {...emptyListHelp("tags")}
      />
    );
  }

  return (
    <Stack
      role="list"
      aria-label="Tags"
      direction="row"
      spacing={1}
      flexWrap="wrap"
      useFlexGap
    >
      {tags.map((item) => (
        <Box role="listitem" key={item.tag.id}>
          <TagCountChipUI {...item} />
        </Box>
      ))}
    </Stack>
  );
};
