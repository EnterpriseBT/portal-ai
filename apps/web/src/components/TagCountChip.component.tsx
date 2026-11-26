import React from "react";

import Chip from "@mui/material/Chip";

import { RouterLink } from "./RouterLink.component";
import { TagColorDotUI } from "./TagColorDot.component";

export interface TagCountChipUIProps {
  tag: { id: string; name: string; color: string | null };
  /** How many objects carry the tag. */
  count: number;
}

/**
 * A tag and how many objects carry it (#1123), as a link to the tag's page.
 * The count is part of the visible text, so the link's name says it too.
 */
export const TagCountChipUI: React.FC<TagCountChipUIProps> = ({
  tag,
  count,
}) => (
  <Chip
    component={RouterLink}
    href={`/tags/${tag.id}`}
    clickable
    size="small"
    variant="outlined"
    icon={tag.color ? <TagColorDotUI color={tag.color} /> : undefined}
    label={`${tag.name} (${count})`}
  />
);
