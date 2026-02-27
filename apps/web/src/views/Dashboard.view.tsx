import { Box, StatusMessage, Typography } from "@mcp-ui/core/ui";
import { sdk } from "../api/sdk";

export const DashboardView = () => {
  const { isLoading, error } = sdk.health.check();

  return (
    <Box>
      <Typography variant="h1">Dashboard</Typography>
      <StatusMessage
        message={error?.message}
        variant={error ? "error" : "success"}
        loading={isLoading}
      />
    </Box>
  );
};
