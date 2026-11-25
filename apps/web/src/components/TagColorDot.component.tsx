import React from "react";

import { Box } from "@portalai/core/ui";

export interface TagColorDotUIProps {
  /** The tag's own colour. */
  color: string;
  /** Diameter in px: 12 beside a chip or option label, 16 on a card. */
  size?: 12 | 16;
  /**
   * Passed through so a host can style the dot: MUI's Chip gives its icon
   * the `MuiChip-icon` class, which carries the icon's margins.
   */
  className?: string;
}

/**
 * A tag's colour dot (#1070, #1115), beside its name on a chip, a card and
 * a picker option. Decorative: the name always sits next to it.
 */
export const TagColorDotUI: React.FC<TagColorDotUIProps> = ({
  color,
  size = 12,
  className,
}) => (
  <Box
    className={className}
    data-testid="tag-color-dot"
    aria-hidden
    // The dot's colour is the tag's own, so it can't live in the theme.
    sx={{
      width: size,
      height: size,
      borderRadius: "50%",
      backgroundColor: color,
      flexShrink: 0,
    }}
  />
);
