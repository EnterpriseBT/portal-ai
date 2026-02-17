import { Box, Typography } from "@mcp-ui/core/ui";
import React from "react";

export interface ErrorViewProps {
  message?: string;
}

export const ErrorView: React.FC<ErrorViewProps> = ({ message }) => {
  return (
    <Box>
      <Typography variant="h2" color="error">
        {message || "An error occurred while loading the application."}
      </Typography>
    </Box>
  );
};
