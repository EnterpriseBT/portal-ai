import { Box, CircularProgress } from "@portalai/core/ui";

export const LoadingView = () => {
  return (
    <Box data-testid="loading-view" display="flex" justifyContent="center">
      <CircularProgress />
    </Box>
  );
};
