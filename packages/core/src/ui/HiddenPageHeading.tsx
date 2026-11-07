import React from "react";
import Box from "@mui/material/Box";

import { visuallyHidden } from "./visually-hidden.js";

export interface HiddenPageHeadingProps {
  children: React.ReactNode;
}

/**
 * A page's h1 before its visible header can render: while its data loads,
 * or when the item isn't there (#982). Every page has exactly one h1 (#797),
 * so a screen reader can land on it and the route announcer can title the
 * tab from it. It lives in core, with its hiding recipe, so no app styles it
 * ad hoc.
 */
export const HiddenPageHeading: React.FC<HiddenPageHeadingProps> = ({
  children,
}) => (
  <Box component="h1" sx={visuallyHidden}>
    {children}
  </Box>
);
