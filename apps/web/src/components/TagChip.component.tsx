import React from "react";

import Chip from "@mui/material/Chip";

import { Box } from "@portalai/core/ui";

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
    icon={
      tag.color ? (
        <Box
          data-testid="tag-color-dot"
          // The dot's colour is the tag's own, so it can't live in the theme.
          sx={{
            width: 12,
            height: 12,
            borderRadius: "50%",
            backgroundColor: tag.color,
            flexShrink: 0,
          }}
        />
      ) : undefined
    }
    onDelete={onDelete}
  />
);
