import React from "react";
import { Box } from "@portalai/core/ui";

import { MAIN_CONTENT_ID, SkipLinks } from "../components/SkipLinks.component";

export const FullScreenLayout = ({
  children,
}: {
  children: React.ReactNode;
}) => (
  <Box display="flex" flexDirection="column" height="100vh">
    <SkipLinks />
    <Box
      component="main"
      id={MAIN_CONTENT_ID}
      tabIndex={-1}
      display="flex"
      flexDirection="column"
      flex={1}
      minHeight={0}
      sx={{ "&:focus": { outline: "none" } }}
    >
      {children}
    </Box>
  </Box>
);
