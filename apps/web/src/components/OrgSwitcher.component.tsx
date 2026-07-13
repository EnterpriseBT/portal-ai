import React from "react";

import { Select, Typography, Box } from "@portalai/core/ui";
import { useQueryClient } from "@tanstack/react-query";

import { sdk } from "../api/sdk";

import type { UserMembership } from "@portalai/core/contracts";

export interface OrgSwitcherUIProps {
  memberships: UserMembership[];
  onSwitch: (organizationId: string) => void;
  isSwitching?: boolean;
}

const orgNameSx = (theme: { spacing: (...n: number[]) => string }) => ({
  padding: theme.spacing(1, 2),
});

/**
 * Pure UI: the account menu's organization indicator + switcher.
 *
 * - 0 orgs → nothing.
 * - 1 org  → the org name as a plain label (nothing to switch to).
 * - 2+ orgs → a compact dropdown whose value is the current org; picking a
 *   different one switches. No "switch" label — a dropdown showing the current
 *   org is self-evidently switchable, and it stays one row tall no matter how
 *   many orgs the user has.
 *
 * Wrapped in a click-stopping Box so interacting with the dropdown doesn't
 * bubble to the parent account `<Menu onClick={close}>` and close it.
 */
export const OrgSwitcherUI: React.FC<OrgSwitcherUIProps> = ({
  memberships,
  onSwitch,
  isSwitching,
}) => {
  if (memberships.length === 0) {
    return null;
  }

  if (memberships.length === 1) {
    return (
      <Typography
        variant="subtitle2"
        sx={(theme) => ({
          color: theme.palette.text.secondary,
          ...orgNameSx(theme),
        })}
      >
        {memberships[0].organization.name}
      </Typography>
    );
  }

  const currentId = memberships.find((m) => m.isCurrent)?.organization.id ?? "";

  return (
    <Box sx={orgNameSx} onClick={(e) => e.stopPropagation()}>
      <Select
        fullWidth
        variant="standard"
        value={currentId}
        disabled={isSwitching}
        aria-label="Organization"
        // Drop the standard-variant underline — the account menu's Divider
        // below already separates this row, so the underline is redundant.
        slotProps={{ input: { disableUnderline: true } }}
        options={memberships.map((m) => ({
          value: m.organization.id,
          label: m.organization.name,
        }))}
        onChange={(e) => {
          const id = e.target.value;
          if (id && id !== currentId) onSwitch(id);
        }}
      />
    </Box>
  );
};

/**
 * Container: reads the user's memberships and wires the switch mutation.
 * On success it invalidates the ENTIRE query cache — after an org change
 * essentially all cached data is stale (every org-scoped query resolves
 * against the request's current org). The rare legitimate broad
 * invalidation. (#201)
 */
export const OrgSwitcher: React.FC = () => {
  const queryClient = useQueryClient();
  const { data } = sdk.organizations.memberships();
  const { mutate, isPending } = sdk.organizations.switch();

  const memberships = data?.memberships ?? [];

  const handleSwitch = (organizationId: string) => {
    mutate(
      { organizationId },
      {
        onSuccess: () => {
          void queryClient.invalidateQueries();
        },
      }
    );
  };

  return (
    <OrgSwitcherUI
      memberships={memberships}
      onSwitch={handleSwitch}
      isSwitching={isPending}
    />
  );
};
