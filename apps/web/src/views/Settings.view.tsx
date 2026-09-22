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
import { Chip } from "@mui/material";
import useMediaQuery from "@mui/material/useMediaQuery";
import { useTheme } from "@mui/material/styles";
import { useQueryClient } from "@tanstack/react-query";
import { AuditLogActivity } from "../components/AuditLogActivity.component";
import { MembersTab } from "../components/MembersTab.component";
import { AccessAuthoring } from "../modules/AccessAuthoring";
import { useCustomRbacEntitled } from "../utils/use-custom-rbac-entitled.util";
import { DataResult } from "../components/DataResult.component";
import { DeleteOrganizationDialog } from "../components/DeleteOrganizationDialog.component";
import { UsageLedgerDialog } from "../components/UsageLedgerDialog.component";
import { SubscriptionBilling } from "../components/SubscriptionBilling.component";
import { sdk } from "../api/sdk";
import { useToast } from "../utils/toast.context";
import { queryKeys } from "../api/keys";
import { toServerError } from "../utils/api.util";
import { useCapabilities } from "../utils/use-capabilities.util";
import { formatUsageValue } from "../utils/usage-format.util";
import { formatSeats } from "../utils/tier-format.util";
import {
  SETTINGS_TAB_INDEX,
  SettingsTab,
  settingsTabIndexFromSearch,
} from "../utils/routes.util";

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
  const { tabsProps, getTabProps, getTabPanelProps, setValue } = useTabs(
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

  // Capability-aware gating (#620). Single source: sdk.organizations.current()
  // via useCapabilities(); the server's PermissionService is the real boundary,
  // this hides affordances the caller can't use. Each elevated tab gates on the
  // capability it needs — never a role name.
  const { roles, groups, can, capabilitiesKnown } = useCapabilities();
  const canManageMembers = can("member.invite");
  const canViewActivity = can("org.audit.read");
  const canDeleteOrg = can("org.delete");
  // #622: the Access (custom RBAC) tab shows to owner/admin (the capability);
  // the entitlement toggles the authoring module vs. a locked upgrade state.
  const canAuthorAccess = can("member.role.assign");
  const rbacEntitled = useCustomRbacEntitled();

  // A caller who deep-linked to an elevated tab they can't use falls back to
  // the first tab once capabilities resolve. Adjust-state-during-render
  // (converges: after the reset the guard is false), the same pattern
  // UsageLedgerDialog uses for reopen.
  const elevatedTabUnavailable =
    (tabsProps.value === SETTINGS_TAB_INDEX[SettingsTab.Members] &&
      !canManageMembers) ||
    (tabsProps.value === SETTINGS_TAB_INDEX[SettingsTab.Activity] &&
      !canViewActivity) ||
    (tabsProps.value === SETTINGS_TAB_INDEX[SettingsTab.Access] &&
      !canAuthorAccess);
  if (capabilitiesKnown && elevatedTabUnavailable) {
    setValue(0);
  }
  // Clamp the value handed to MUI Tabs to a currently-rendered index: while
  // capabilities are still loading, a `?tab=members|activity` deep-link seeds
  // index 3/4 before those tabs mount, and MUI warns "value … none of the
  // children match". The setValue(0) reset above only fires once capabilities
  // are known, so the clamp covers the loading window (and the not-allowed
  // case until the reset lands). Once the elevated tab renders, the raw value
  // is valid and honored.
  const activeTabValue = elevatedTabUnavailable ? 0 : tabsProps.value;

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

      <Tabs {...tabsProps} value={activeTabValue} variant="scrollable">
        <Tab label="Profile" {...getTabProps(0)} />
        <Tab label="Organization" {...getTabProps(1)} />
        <Tab label="Subscription & Billing" {...getTabProps(2)} />
        {canManageMembers && <Tab label="Members" {...getTabProps(3)} />}
        {canViewActivity && <Tab label="Activity" {...getTabProps(4)} />}
        {canAuthorAccess && <Tab label="Access" {...getTabProps(5)} />}
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
                  <Divider />
                  {/* #620: the caller's roles + groups in the current org,
                      shown by name (never a role-name heuristic). Groups are
                      populated by #622. */}
                  <Stack spacing={0.5}>
                    <Typography variant="subtitle2">Your roles</Typography>
                    <Stack
                      direction="row"
                      spacing={0.5}
                      flexWrap="wrap"
                      useFlexGap
                    >
                      {roles.length > 0 ? (
                        roles.map((r) => (
                          <Chip key={r} size="small" label={r} />
                        ))
                      ) : (
                        <Typography variant="body2" color="text.secondary">
                          No roles assigned
                        </Typography>
                      )}
                    </Stack>
                  </Stack>
                  <Stack spacing={0.5}>
                    <Typography variant="subtitle2">Your groups</Typography>
                    {groups.length > 0 ? (
                      <Stack
                        direction="row"
                        spacing={0.5}
                        flexWrap="wrap"
                        useFlexGap
                      >
                        {groups.map((g) => (
                          <Chip key={g} size="small" label={g} />
                        ))}
                      </Stack>
                    ) : (
                      <Typography variant="body2" color="text.secondary">
                        You don&apos;t belong to any groups yet.
                      </Typography>
                    )}
                  </Stack>
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
                          label: "Seats",
                          value: formatSeats(tier.maxSeats),
                          icon: (
                            <Icon name={IconName.Person} fontSize="small" />
                          ),
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
                      disabled={!canDeleteOrg}
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
      {canManageMembers && (
        <TabPanel {...getTabPanelProps(3)}>
          <PageSection title="Members" variant="outlined">
            {/* Mounted only while active so the members/invitations queries
                fire only on this tab (#585). */}
            {tabsProps.value === 3 && <MembersTab />}
          </PageSection>
        </TabPanel>
      )}
      {canViewActivity && (
        <TabPanel {...getTabPanelProps(4)}>
          <PageSection title="Activity" variant="outlined">
            {/* Mounted only while active so the audit-log query fires only
                on this tab (#596). */}
            {tabsProps.value === 4 && <AuditLogActivity />}
          </PageSection>
        </TabPanel>
      )}
      {canAuthorAccess && (
        <TabPanel {...getTabPanelProps(5)}>
          <PageSection title="Access" variant="outlined">
            {/* #622: the module renders only when the org's tier grants custom
                RBAC; otherwise a locked upgrade state (the server is the real
                gate). Mounted only while active so its queries fire on-tab. */}
            {tabsProps.value === 5 &&
              (rbacEntitled ? (
                <AccessAuthoring />
              ) : (
                <Stack spacing={1}>
                  <Typography variant="body1">
                    Custom roles, policies, and groups are an enterprise
                    feature.
                  </Typography>
                  <Typography variant="body2" color="text.secondary">
                    Your current plan includes the built-in owner, admin, and
                    member roles. Upgrade to author custom access.
                  </Typography>
                </Stack>
              ))}
          </PageSection>
        </TabPanel>
      )}
    </Box>
  );
};
