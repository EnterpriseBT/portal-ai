import React from "react";
import { Box } from "@portalai/core/ui";

import { MAIN_CONTENT_ID, SkipLinks } from "../components/SkipLinks.component";
import { useRouteAnnouncer } from "../utils/route-announcer.util";

export const FullScreenLayout = ({
  children,
}: {
  children: React.ReactNode;
}) => {
  useRouteAnnouncer();
  return (
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
};
