import {
  Avatar,
  Box,
  Card,
  CardContent,
  Typography,
  Tabs,
  Tab,
  TabPanel,
  useTabs,
  Stack,
  Icon,
  IconName,
} from "@mcp-ui/core/ui";
import { DataResult } from "../components/DataResult.component";
import { sdk } from "../api/sdk";
export const SettingsView = () => {
  const { tabsProps, getTabProps, getTabPanelProps } = useTabs();
  const profileResult = sdk.auth.profile();

  return (
    <Box>
      <Typography variant="h1" gutterBottom>
        Settings
      </Typography>

      <Tabs {...tabsProps} variant="scrollable">
        <Tab label="Profile" {...getTabProps(0)} />
        <Tab label="Organization" {...getTabProps(1)} />
      </Tabs>
      <TabPanel {...getTabPanelProps(0)}>
        <Card>
          <CardContent>
            <DataResult results={{ profileResult }}>
              {({ profileResult }) => {
                const { profile } = profileResult;
                return (
                  <Stack
                    direction={{ xs: "column", sm: "row" }}
                    spacing={{ xs: 2, sm: 3 }}
                    alignItems={{ xs: "center", sm: "center" }}
                  >
                    <Avatar
                      src={profile.picture}
                      alt={profile.name}
                      sx={{
                        width: { xs: 56, sm: 72 },
                        height: { xs: 56, sm: 72 },
                        flexShrink: 0,
                      }}
                    >
                      {!profile.picture && (
                        <Icon name={IconName.Person} fontSize="large" />
                      )}
                    </Avatar>
                    <Stack
                      spacing={0.5}
                      sx={{
                        minWidth: 0,
                        flex: 1,
                        textAlign: { xs: "center", sm: "left" },
                      }}
                    >
                      <Typography
                        variant="h2"
                        noWrap
                        sx={{ fontSize: { xs: "1.25rem", sm: "1.5rem" } }}
                      >
                        {profile.name}
                      </Typography>
                      {profile.nickname && (
                        <Typography
                          variant="body2"
                          color="text.secondary"
                          noWrap
                          sx={{ fontSize: { xs: "0.75rem", sm: "0.875rem" } }}
                        >
                          @{profile.nickname}
                        </Typography>
                      )}
                      <Typography
                        variant="body1"
                        color="text.secondary"
                        sx={{
                          fontSize: { xs: "0.8125rem", sm: "1rem" },
                          wordBreak: "break-all",
                        }}
                      >
                        {profile.email}
                      </Typography>
                      {profileResult.lastLogin && (
                        <Typography
                          variant="body2"
                          color="text.secondary"
                          sx={{ fontSize: { xs: "0.75rem", sm: "0.875rem" } }}
                        >
                          Last login:{" "}
                          {new Date(profileResult.lastLogin).toLocaleString()}
                        </Typography>
                      )}
                    </Stack>
                  </Stack>
                );
              }}
            </DataResult>
          </CardContent>
        </Card>
      </TabPanel>
      <TabPanel {...getTabPanelProps(1)}>
        <Typography variant="h2">Organization</Typography>
        {/*  render organization content here */}
      </TabPanel>
    </Box>
  );
};
