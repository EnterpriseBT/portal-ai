import React from "react";

import { Box, visuallyHidden } from "@portalai/core/ui";

export interface HiddenPageHeadingProps {
  children: React.ReactNode;
}

/**
 * A page's h1 before its visible header can render: while its data loads,
 * or when the item isn't there. Every page has exactly one h1 (#797), so a
 * screen reader can land on it and the route announcer can title the tab
 * from it. `DataResult`'s `pageTitle` renders this; a view that doesn't go
 * through `DataResult` renders it in its own loading and not-found states.
 */
export const HiddenPageHeading: React.FC<HiddenPageHeadingProps> = ({
  children,
}) => (
  <Box component="h1" sx={visuallyHidden}>
    {children}
  </Box>
);
