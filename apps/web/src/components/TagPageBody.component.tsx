import React from "react";

import { EmptyState, Icon, IconName, Stack } from "@portalai/core/ui";

import {
  TagResultGroupUI,
  type TagResultGroupUIProps,
} from "./TagResultGroup.component";
import { emptyListHelp } from "../utils/empty-list-help.util";

export interface TagPageBodyUIProps {
  /** One group per taggable type, in the order to show them. */
  groups: TagResultGroupUIProps[];
}

/**
 * The body of a tag's page (#1123): what carries the tag, grouped by type.
 * When nothing carries it, one teaching empty state replaces the groups.
 */
export const TagPageBodyUI: React.FC<TagPageBodyUIProps> = ({ groups }) => {
  if (groups.every((group) => group.total === 0)) {
    return (
      <EmptyState
        icon={<Icon name={IconName.Label} />}
        title="Nothing has this tag yet"
        {...emptyListHelp("tags")}
      />
    );
  }

  return (
    <Stack spacing={3}>
      {groups.map((group) => (
        <TagResultGroupUI key={group.title} {...group} />
      ))}
    </Stack>
  );
};
