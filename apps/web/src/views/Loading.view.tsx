import { Box, CircularProgress } from "@mcp-ui/core";

export const LoadingView = () => {
  return (
    <Box data-testid="loading-view" display="flex" justifyContent="center">
      <CircularProgress />
    </Box>
  );
};
