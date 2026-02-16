import { Box, Typography, useTheme } from "@mcp-ui/core";
import { alpha } from "@mui/material/styles";
import { useHealth } from "../api/health";

export const DashboardView = () => {
  const { data, isLoading, error } = useHealth();
  const { theme } = useTheme();

  return (
    <Box>
      <Typography variant="h1">Dashboard</Typography>

      {isLoading && (
        <Box
          role="alert"
          style={{
            padding: "12px 16px",
            marginTop: "16px",
            borderRadius: "6px",
            backgroundColor: alpha(theme.palette.info.main, 0.12),
            color: theme.palette.info.dark,
          }}
        >
          Checking API connection…
        </Box>
      )}

      {error && (
        <Box
          role="alert"
          style={{
            padding: "12px 16px",
            marginTop: "16px",
            borderRadius: "6px",
            backgroundColor: alpha(theme.palette.error.main, 0.12),
            color: theme.palette.error.dark,
          }}
        >
          API connection failed: {error.message}
        </Box>
      )}

      {data?.success && (
        <Box
          role="alert"
          style={{
            padding: "12px 16px",
            marginTop: "16px",
            borderRadius: "6px",
            backgroundColor: alpha(theme.palette.success.main, 0.12),
            color: theme.palette.success.dark,
          }}
        >
          API is healthy — last check: {data.payload.timestamp}
        </Box>
      )}
    </Box>
  );
};
