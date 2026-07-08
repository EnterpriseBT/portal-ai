import {
  Avatar,
  Box,
  Divider,
  MetadataList,
  Typography,
  Tabs,
  Tab,
  TabPanel,
  useTabs,
  Stack,
  Icon,
  IconName,
  PageHeader,
  PageSection,
} from "@portalai/core/ui";
import useMediaQuery from "@mui/material/useMediaQuery";
import { useTheme } from "@mui/material/styles";
import { DataResult } from "../components/DataResult.component";
import { sdk } from "../api/sdk";
import { formatUsageValue } from "../utils/usage-format.util";

/** Present a tier slug as a human label, e.g. "enterprise-acme" → "Enterprise Acme". */
const formatTierName = (slug: string): string =>
  slug
    .split(/[-_]/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");

export const SettingsView = () => {
  const { tabsProps, getTabProps, getTabPanelProps } = useTabs();
  const theme = useTheme();
  // Small screens + tablets stack each field/value pair vertically; desktop
  // (md+) shows them side-by-side. Layout is the view's call, not the list's.
  const stackVertically = useMediaQuery(theme.breakpoints.down("md"));
  const metadataLayout = stackVertically ? "stacked" : "responsive";
  const profileResult = sdk.auth.profile();
  const organizationResult = sdk.organizations.current();
  const usageResult = sdk.organizations.usage();

  return (
    <Box>
      <PageHeader title="Settings" icon={<Icon name={IconName.Settings} />} />

      <Tabs {...tabsProps} variant="scrollable">
        <Tab label="Profile" {...getTabProps(0)} />
        <Tab label="Organization" {...getTabProps(1)} />
      </Tabs>
      <TabPanel {...getTabPanelProps(0)}>
        <PageSection title="Profile" variant="outlined">
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
                  <MetadataList
                    size="medium"
                    layout={metadataLayout}
                    direction="vertical"
                    items={[
                      { label: "Email", value: profile.email },
                      {
                        label: "Last login",
                        value: profileResult.lastLogin
                          ? new Date(profileResult.lastLogin).toLocaleString()
                          : "",
                        hidden: !profileResult.lastLogin,
                      },
                    ]}
                  />
                </Stack>
              );
            }}
          </DataResult>
        </PageSection>
      </TabPanel>
      <TabPanel {...getTabPanelProps(1)}>
        <DataResult results={{ organizationResult, usageResult }}>
          {({ organizationResult, usageResult }) => {
            const { organization } = organizationResult;
            const { tier, usage } = usageResult;
            return (
              <Stack spacing={3}>
                <PageSection title="Organization" variant="outlined">
                  <Stack spacing={2}>
                    <Stack
                      direction={{ xs: "column", sm: "row" }}
                      spacing={{ xs: 2, sm: 3 }}
                      alignItems="center"
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
                    <MetadataList
                      size="medium"
                      layout={metadataLayout}
                      direction="vertical"
                      items={[
                        { label: "Timezone", value: organization.timezone },
                        {
                          label: "Created",
                          value: new Date(
                            organization.created
                          ).toLocaleString(),
                        },
                        {
                          label: "Updated",
                          value: organization.updated
                            ? new Date(organization.updated).toLocaleString()
                            : "",
                          hidden: !organization.updated,
                        },
                      ]}
                    />
                  </Stack>
                </PageSection>

                <PageSection title="Subscription & Usage" variant="outlined">
                  <MetadataList
                    size="medium"
                    layout={metadataLayout}
                    direction="vertical"
                    items={[
                      {
                        label: "Subscription Tier",
                        value: formatTierName(tier.tier),
                        icon: <Icon name={IconName.Star} fontSize="small" />,
                      },
                      {
                        label: "Metered usage",
                        value: formatUsageValue(usage.byClass.metered),
                        icon: <Icon name={IconName.Search} fontSize="small" />,
                      },
                      {
                        label: "Expensive usage",
                        value: formatUsageValue(usage.byClass.expensive),
                        icon: (
                          <Icon name={IconName.MemoryChip} fontSize="small" />
                        ),
                      },
                      {
                        label: "Free usage",
                        value: formatUsageValue(usage.byClass.free),
                        icon: (
                          <Icon name={IconName.CheckCircle} fontSize="small" />
                        ),
                      },
                    ]}
                  />
                </PageSection>
              </Stack>
            );
          }}
        </DataResult>
      </TabPanel>
    </Box>
  );
};
