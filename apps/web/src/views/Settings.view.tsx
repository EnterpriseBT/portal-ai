import {
  Avatar,
  Box,
  Card,
  CardContent,
  Divider,
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
  const organizationResult = sdk.organizations.current();

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
                  <Stack spacing={2}>
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
                          sx={{ fontSize: { xs: "1.25rem", sm: "1.5rem" } }}
                        >
                          {profile.name}
                        </Typography>
                        {profile.nickname && (
                          <Typography
                            variant="body2"
                            color="text.secondary"
                            sx={{
                              fontSize: { xs: "0.75rem", sm: "0.875rem" },
                            }}
                          >
                            @{profile.nickname}
                          </Typography>
                        )}
                      </Stack>
                    </Stack>
                    <Divider />
                    <Stack spacing={1.5}>
                      <Typography
                        variant="body1"
                        sx={{
                          fontSize: { xs: "0.8125rem", sm: "1rem" },
                          wordBreak: "break-all",
                        }}
                      >
                        <Box
                          component="span"
                          fontWeight={600}
                          color="text.primary"
                        >
                          Email:
                        </Box>{" "}
                        <Box component="span" color="text.secondary">
                          {profile.email}
                        </Box>
                      </Typography>
                      {profileResult.lastLogin && (
                        <Typography
                          variant="body1"
                          sx={{ fontSize: { xs: "0.8125rem", sm: "1rem" } }}
                        >
                          <Box
                            component="span"
                            fontWeight={600}
                            color="text.primary"
                          >
                            Last login:
                          </Box>{" "}
                          <Box component="span" color="text.secondary">
                            {new Date(profileResult.lastLogin).toLocaleString()}
                          </Box>
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
        <Card>
          <CardContent>
            <DataResult results={{ organizationResult }}>
              {({ organizationResult }) => {
                const { organization } = organizationResult;
                return (
                  <Stack spacing={2}>
                    <Stack
                      direction={{ xs: "column", sm: "row" }}
                      spacing={{ xs: 2, sm: 3 }}
                      alignItems={{ xs: "center", sm: "center" }}
                    >
                      <Avatar
                        sx={{
                          width: { xs: 56, sm: 72 },
                          height: { xs: 56, sm: 72 },
                          flexShrink: 0,
                        }}
                      >
                        <Icon name={IconName.Home} fontSize="large" />
                      </Avatar>
                      <Typography
                        variant="h2"
                        sx={{ fontSize: { xs: "1.25rem", sm: "1.5rem" } }}
                      >
                        {organization.name}
                      </Typography>
                    </Stack>
                    <Divider />
                    <Stack spacing={1.5}>
                      <Typography
                        variant="body1"
                        sx={{ fontSize: { xs: "0.8125rem", sm: "1rem" } }}
                      >
                        <Box
                          component="span"
                          fontWeight={600}
                          color="text.primary"
                        >
                          Timezone:
                        </Box>{" "}
                        <Box component="span" color="text.secondary">
                          {organization.timezone}
                        </Box>
                      </Typography>
                      <Typography
                        variant="body1"
                        sx={{ fontSize: { xs: "0.8125rem", sm: "1rem" } }}
                      >
                        <Box
                          component="span"
                          fontWeight={600}
                          color="text.primary"
                        >
                          Created:
                        </Box>{" "}
                        <Box component="span" color="text.secondary">
                          {new Date(organization.created).toLocaleString()}
                        </Box>
                      </Typography>
                      {organization.updated && (
                        <Typography
                          variant="body1"
                          sx={{ fontSize: { xs: "0.8125rem", sm: "1rem" } }}
                        >
                          <Box
                            component="span"
                            fontWeight={600}
                            color="text.primary"
                          >
                            Updated:
                          </Box>{" "}
                          <Box component="span" color="text.secondary">
                            {new Date(organization.updated).toLocaleString()}
                          </Box>
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
    </Box>
  );
};
