import React from "react";

import { Box, Icon, IconName, Typography } from "@portalai/core/ui";

export interface UnauthorizedStateProps {
  /** Optional override for the default permission message. */
  message?: string;
}

/**
 * Inline unauthorized panel (#630) — shown in place of a list, tab, table, or
 * dropdown whose data the caller is gated from by their **object** permissions.
 * The honest surface: the affordance stays visible, but the data is replaced
 * with a permission message rather than silently hidden or shown empty. For a
 * whole gated *page*, use `ForbiddenView` instead.
 */
export const UnauthorizedState: React.FC<UnauthorizedStateProps> = ({
  message = "You don't have permission to view this.",
}) => (
  <Box
    role="alert"
    sx={{
      display: "flex",
      flexDirection: "column",
      alignItems: "center",
      gap: 1,
      py: 4,
      color: "text.secondary",
    }}
  >
    <Icon name={IconName.Lock} />
    <Typography variant="body2">{message}</Typography>
  </Box>
);
