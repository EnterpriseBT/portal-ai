import React from "react";

import Chip from "@mui/material/Chip";

import { TagColorDotUI } from "./TagColorDot.component";

export interface TagChipUIProps {
  tag: { id: string; name: string; color: string | null };
  /** Shown as the chip's remove control when set. */
  onDelete?: () => void;
}

/** One tag, as a small chip with its colour dot (#1070). */
export const TagChipUI: React.FC<TagChipUIProps> = ({ tag, onDelete }) => (
  <Chip
    label={tag.name}
    size="small"
    icon={tag.color ? <TagColorDotUI color={tag.color} /> : undefined}
    onDelete={onDelete}
  />
);
