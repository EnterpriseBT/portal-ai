import { useEffect, useState } from "react";

import {
  Avatar,
  Box,
  Button,
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
import { useQueryClient } from "@tanstack/react-query";
import { DataResult } from "../components/DataResult.component";
import { DeleteOrganizationDialog } from "../components/DeleteOrganizationDialog.component";
import { UsageLedgerDialog } from "../components/UsageLedgerDialog.component";
import { SubscriptionBilling } from "../components/SubscriptionBilling.component";
import { sdk } from "../api/sdk";
import { useToast } from "../utils/toast.context";
import { queryKeys } from "../api/keys";
import { toServerError } from "../utils/api.util";
import { formatUsageValue } from "../utils/usage-format.util";
import { settingsTabIndexFromSearch } from "../utils/routes.util";

/** Present a tier slug as a human label, e.g. "enterprise-acme" → "Enterprise Acme". */
const formatTierName = (slug: string): string =>
  slug
    .split(/[-_]/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");

export const SettingsView = () => {
  // #284: unentitled-toolpack affordances link to /settings?tab=billing, so
  // the tab is seeded from the param at mount. Read the same way as the
  // ?billing= checkout return below; clicking a tab does not rewrite it.
  const { tabsProps, getTabProps, getTabPanelProps } = useTabs(
    settingsTabIndexFromSearch(window.location.search)
  );
  const theme = useTheme();
  const queryClient = useQueryClient();

  const toast = useToast();

  // Checkout return handling (#176): Stripe redirects back to
  // /settings?billing={success,cancelled}. The webhook is the tier writer —
  // the redirect only refreshes the org cache and tells the user what
  // happened, then strips the param so a reload doesn't re-toast.
  //
  // #293: the message used to be derived in a useState initializer to avoid
  // setState-in-effect. Raising a toast is imperative, so it moves into the
  // effect that already reads the param — one effect, no local state. Under
  // StrictMode's double-invoked effects the toast provider's dedupe (identical
  // message + severity while visible) collapses the second raise.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const billing = params.get("billing");
    if (!billing) return;

    if (billing === "success") {
      // The webhook already wrote the tier — just refresh the org cache.
      queryClient.invalidateQueries({
        queryKey: queryKeys.organizations.root,
      });
      toast.success(
        "Subscription confirmed — your plan updates within a few seconds"
      );
    }
    if (billing === "cancelled") {
      toast.info("Checkout cancelled — your plan is unchanged");
    }

    params.delete("billing");
    const query = params.toString();
    window.history.replaceState(
      null,
      "",
      `${window.location.pathname}${query ? `?${query}` : ""}`
    );
  }, [queryClient, toast]);
  // Small screens + tablets stack each field/value pair vertically; desktop
  // (md+) shows them side-by-side. Layout is the view's call, not the list's.
  const stackVertically = useMediaQuery(theme.breakpoints.down("md"));
  const metadataLayout = stackVertically ? "stacked" : "responsive";
  const profileResult = sdk.auth.profile();
  const organizationResult = sdk.organizations.current();
  const usageResult = sdk.organizations.usage();

  // Danger zone (#197): delete the org, then end the session — logout is
  // unconditional on success, even for multi-org users.
  const { logout } = sdk.auth.logout();
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  // Itemized usage drill-down (#179).
  const [ledgerDialogOpen, setLedgerDialogOpen] = useState(false);
  const organizationId = organizationResult.data?.organization.id ?? "";
  const deleteMutation = sdk.organizations.delete(organizationId);

  const handleDeleteConfirm = (confirmationName: string) =>
    deleteMutation.mutate({ confirmationName }, { onSuccess: () => logout() });

  return (
    <Box>
      <PageHeader title="Settings" icon={<Icon name={IconName.Settings} />} />

      <Tabs {...tabsProps} variant="scrollable">
        <Tab label="Profile" {...getTabProps(0)} />
        <Tab label="Organization" {...getTabProps(1)} />
        <Tab label="Subscription & Billing" {...getTabProps(2)} />
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
                  <Stack spacing={2} alignItems="flex-start">
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
                          icon: (
                            <Icon name={IconName.Search} fontSize="small" />
                          ),
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
                            <Icon
                              name={IconName.CheckCircle}
                              fontSize="small"
                            />
                          ),
                        },
                      ]}
                    />
                    {/* #179: per-call drill-down behind the aggregate balance. */}
                    <Button
                      type="button"
                      variant="outlined"
                      onClick={() => setLedgerDialogOpen(true)}
                    >
                      Itemized usage
                    </Button>
                  </Stack>
                </PageSection>

                <UsageLedgerDialog
                  open={ledgerDialogOpen}
                  onClose={() => setLedgerDialogOpen(false)}
                  defaultPeriodId={usage.periodId}
                />

                <PageSection title="Danger zone" variant="outlined">
                  <Stack spacing={2} alignItems="flex-start">
                    <Typography variant="body2" color="text.secondary">
                      Permanently delete this organization and all of its data.
                      Only the organization owner can do this, and it cannot be
                      undone.
                    </Typography>
                    <Button
                      type="button"
                      variant="outlined"
                      color="error"
                      onClick={() => setDeleteDialogOpen(true)}
                    >
                      Delete organization
                    </Button>
                  </Stack>
                </PageSection>

                <DeleteOrganizationDialog
                  open={deleteDialogOpen}
                  onClose={() => setDeleteDialogOpen(false)}
                  organizationName={organization.name}
                  onConfirm={handleDeleteConfirm}
                  isPending={deleteMutation.isPending}
                  serverError={toServerError(deleteMutation.error)}
                />
              </Stack>
            );
          }}
        </DataResult>
      </TabPanel>
      <TabPanel {...getTabPanelProps(2)}>
        <PageSection title="Subscription & Billing" variant="outlined">
          {/* Mounted only while active so the billing queries don't fire
              behind the other tabs. */}
          {tabsProps.value === 2 && <SubscriptionBilling />}
        </PageSection>
      </TabPanel>
    </Box>
  );
};
