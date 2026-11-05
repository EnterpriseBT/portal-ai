import React from "react";

import ButtonBase from "@mui/material/ButtonBase";

import { Box, Typography, visuallyHidden } from "@portalai/core/ui";

export interface SidebarVersionCaptionUIProps {
  collapsed: boolean;
  year: number;
  onClick: () => void;
}

/**
 * The sidebar footer's copyright line, which opens the app version. A button,
 * so it's reachable and announced (#797); it was a clickable caption. Its
 * name is the visible text plus "(app version)".
 */
export const SidebarVersionCaptionUI: React.FC<
  SidebarVersionCaptionUIProps
> = ({ collapsed, year, onClick }) => (
  <ButtonBase
    onClick={onClick}
    sx={{
      display: "block",
      width: "100%",
      textAlign: "center",
      py: 0.5,
      px: 1,
      "&:hover": { textDecoration: "underline" },
    }}
  >
    <Typography
      variant="caption"
      color="text.secondary"
      component="span"
      sx={{ fontSize: "0.65rem" }}
    >
      {collapsed ? `© ${year}` : `Portalsai © ${year}`}
    </Typography>
    {/* The name starts with the visible text (WCAG 2.5.3), then says what
        the button does. */}
    <Box component="span" sx={visuallyHidden}>
      {" "}
      (app version)
    </Box>
  </ButtonBase>
);
