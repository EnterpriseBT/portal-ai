import { Box, CircularProgress } from "@mcp-ui/core";

export const LoadingView = () => {
  return (
    <Box display="flex" justifyContent="center">
      <CircularProgress />
    </Box>
  );
};
