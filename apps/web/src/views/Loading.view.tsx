import { Box, CircularProgress } from "@mcp-ui/core/ui";

export const LoadingView = () => {
  return (
    <Box data-testid="loading-view" display="flex" justifyContent="center">
      <CircularProgress />
    </Box>
  );
};
