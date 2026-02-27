import { Box, Stack, Typography } from "@mcp-ui/core/ui";
import { HealthCheck } from "../components/HealthCheck.component";

export const DashboardView = () => {
  return (
    <Box>
      <Stack direction="row" alignItems="center" gap={1}>
        <HealthCheck />
        <Typography variant="h1">Dashboard</Typography>
      </Stack>
    </Box>
  );
};
