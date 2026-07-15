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
import Alert from "@mui/material/Alert";
import Snackbar from "@mui/material/Snackbar";
import useMediaQuery from "@mui/material/useMediaQuery";
import { useTheme } from "@mui/material/styles";
import { useQueryClient } from "@tanstack/react-query";
import { DataResult } from "../components/DataResult.component";
import { DeleteOrganizationDialog } from "../components/DeleteOrganizationDialog.component";
import { SubscriptionBilling } from "../components/SubscriptionBilling.component";
import { sdk } from "../api/sdk";
import { queryKeys } from "../api/keys";
import { toServerError } from "../utils/api.util";
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
  const queryClient = useQueryClient();

  // Checkout return handling (#176): Stripe redirects back to
  // /settings?billing={success,cancelled}. The webhook is the tier writer —
  // the redirect only refreshes the org cache and tells the user what
  // happened, then strips the param so a reload doesn't re-toast. The toast
  // is derived once from the URL in the initializer (no setState-in-effect).
  const [billingToast, setBillingToast] = useState<{
    message: string;
    severity: "success" | "info";
  } | null>(() => {
    const billing = new URLSearchParams(window.location.search).get("billing");
    if (billing === "success") {
      return {
        message:
          "Subscription confirmed — your plan updates within a few seconds",
        severity: "success",
      };
    }
    if (billing === "cancelled") {
      return {
        message: "Checkout cancelled — your plan is unchanged",
        severity: "info",
      };
    }
    return null;
  });
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const billing = params.get("billing");
    if (!billing) return;

    // The webhook already wrote the tier — just refresh the org cache.
    if (billing === "success") {
      queryClient.invalidateQueries({
        queryKey: queryKeys.organizations.root,
      });
    }

    params.delete("billing");
    const query = params.toString();
    window.history.replaceState(
      null,
      "",
      `${window.location.pathname}${query ? `?${query}` : ""}`
    );
  }, [queryClient]);
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

      <Snackbar
        open={billingToast !== null}
        autoHideDuration={8000}
        onClose={() => setBillingToast(null)}
        anchorOrigin={{ vertical: "bottom", horizontal: "center" }}
      >
        <Alert
          severity={billingToast?.severity ?? "info"}
          onClose={() => setBillingToast(null)}
        >
          {billingToast?.message ?? ""}
        </Alert>
      </Snackbar>
    </Box>
  );
};
