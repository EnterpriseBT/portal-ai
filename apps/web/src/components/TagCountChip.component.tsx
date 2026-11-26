import React from "react";

import Chip from "@mui/material/Chip";

import { TagColorDotUI } from "./TagColorDot.component";

export interface TagCountChipUIProps {
  tag: { id: string; name: string; color: string | null };
  /** How many objects carry the tag. */
  count: number;
  /** This tag's matches are showing. */
  selected?: boolean;
  onToggle?: (tagId: string) => void;
  /** The id of the list its matches show in, while selected. */
  controls?: string;
}

/**
 * A tag and how many objects carry it (#1123), as a toggle: pressing it
 * shows the objects that carry the tag, pressing it again hides them. The
 * count is part of the visible text, so the button's name says it too.
 */
export const TagCountChipUI: React.FC<TagCountChipUIProps> = ({
  tag,
  count,
  selected = false,
  onToggle,
  controls,
}) => (
  <Chip
    size="small"
    variant={selected ? "filled" : "outlined"}
    color={selected ? "primary" : "default"}
    icon={tag.color ? <TagColorDotUI color={tag.color} /> : undefined}
    label={`${tag.name} (${count})`}
    // A toggle only when something handles it; otherwise a plain label.
    onClick={onToggle ? () => onToggle(tag.id) : undefined}
    aria-pressed={onToggle ? selected : undefined}
    aria-controls={onToggle && selected ? controls : undefined}
  />
);
