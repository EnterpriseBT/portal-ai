import React from "react";
import { Box } from "@portalai/core/ui";

export const PortalLayout = ({
  children,
}: {
  children: React.ReactNode;
}) => (
  <Box display="flex" flexDirection="column" height="100vh">
    {children}
  </Box>
);
