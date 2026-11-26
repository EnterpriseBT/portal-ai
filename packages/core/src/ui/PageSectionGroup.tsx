import React from "react";
import Divider from "@mui/material/Divider";
import Paper from "@mui/material/Paper";
import Stack from "@mui/material/Stack";

export interface PageSectionGroupProps {
  /** The sections to frame together, usually `PageSection variant="plain"`. */
  children: React.ReactNode;
  className?: string;
  [key: `data-${string}`]: string;
}

/**
 * Several page sections in one outlined frame, divided by rules. Each
 * section keeps its own `h2`, so the outline still lists them separately;
 * only the frame is shared. Used where short sections read better together
 * than as separate cards (the dashboard's Browse by tag and Needs attention).
 */
export const PageSectionGroup = React.forwardRef<
  HTMLDivElement,
  PageSectionGroupProps
>(({ children, className, ...rest }, ref) => (
  <Paper
    ref={ref}
    variant="outlined"
    className={className}
    // The same inset as an outlined PageSection.
    sx={{ p: 2.5 }}
    {...rest}
  >
    <Stack spacing={2.5} divider={<Divider />}>
      {children}
    </Stack>
  </Paper>
));

PageSectionGroup.displayName = "PageSectionGroup";

export default PageSectionGroup;
