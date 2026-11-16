import React from "react";
import Box from "@mui/material/Box";

import { visuallyHidden } from "./visually-hidden.js";

export interface VisuallyHiddenProps {
  children: React.ReactNode;
}

/**
 * Text for screen readers only (#794): a name for an empty header cell, a
 * label that would repeat what's on screen. The app renders this rather than
 * an ad hoc `sx`, since styling lives in core.
 */
export const VisuallyHidden: React.FC<VisuallyHiddenProps> = ({ children }) => (
  <Box component="span" sx={visuallyHidden}>
    {children}
  </Box>
);

export default VisuallyHidden;
