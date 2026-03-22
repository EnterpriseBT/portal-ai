import { Box, Breadcrumbs, Card, CardContent, Stack, Typography } from "@portalai/core/ui";
import { IconName } from "@portalai/core/ui";
import { HealthCheck } from "../components/HealthCheck.component";

export const DashboardView = () => {
  return (
    <Box>
      <Breadcrumbs items={[{ label: "Dashboard", icon: IconName.Home }]} />
      <Stack direction="row" alignItems="center" gap={1}>
        <HealthCheck />
        <Typography variant="h1">Dashboard</Typography>
      </Stack>
      <Box sx={{ mt: 4, display: "flex", justifyContent: "center" }}>
        <Card
          variant="outlined"
          sx={(theme) => ({
            width: 360,
            textAlign: "center",
            borderStyle: "dashed",
            borderColor: theme.palette.divider,
            borderRadius: 3,
          })}
        >
          <CardContent sx={{ py: 5 }}>
            <Typography variant="h1" sx={{ fontSize: "2.5rem", mb: 1 }}>
              🚧
            </Typography>
            <Typography variant="h6" gutterBottom>
              Under Construction
            </Typography>
            <Typography variant="body2" color="text.secondary">
              This page is coming soon. Check back later.
            </Typography>
          </CardContent>
        </Card>
      </Box>
    </Box>
  );
};
