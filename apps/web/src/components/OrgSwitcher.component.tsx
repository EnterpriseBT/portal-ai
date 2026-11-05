import React from "react";

import ListSubheader from "@mui/material/ListSubheader";

import { MenuItem } from "@portalai/core/ui";
import { useQueryClient } from "@tanstack/react-query";

import { sdk } from "../api/sdk";

import type { UserMembership } from "@portalai/core/contracts";

export interface OrgSwitcherUIProps {
  memberships: UserMembership[];
  onSwitch: (organizationId: string) => void;
  isSwitching?: boolean;
}

/**
 * Pure UI: the account menu's organization indicator + switcher (#201),
 * following the APG menu-radio pattern (#797).
 *
 * - 0 orgs → nothing.
 * - 1 org  → the org name as a disabled item (nothing to switch to).
 * - 2+ orgs → an "Organization" label, then one `menuitemradio` per org with
 *   the current one checked. Choosing another switches; the account menu
 *   closes on the click, as for any of its items. A `Select` inside a menu
 *   broke the pattern: a combobox isn't a menu item.
 */
export const OrgSwitcherUI: React.FC<OrgSwitcherUIProps> = ({
  memberships,
  onSwitch,
  isSwitching,
}) => {
  if (memberships.length === 0) {
    return null;
  }

  // One org: its name as a disabled item, so it's read in the menu but
  // offers nothing to do.
  if (memberships.length === 1) {
    return (
      <MenuItem disabled sx={{ "&.Mui-disabled": { opacity: 1 } }}>
        {memberships[0].organization.name}
      </MenuItem>
    );
  }

  return [
    // A visual group label. A menu may only own menu items, groups and
    // separators, and each radio already names its org, so it's hidden
    // from assistive tech.
    <ListSubheader key="label" aria-hidden sx={{ lineHeight: 2.5 }}>
      Organization
    </ListSubheader>,
    ...memberships.map((m) => (
      <MenuItem
        key={m.organization.id}
        role="menuitemradio"
        aria-checked={m.isCurrent}
        selected={m.isCurrent}
        disabled={isSwitching}
        onClick={() => {
          if (!m.isCurrent) onSwitch(m.organization.id);
        }}
      >
        {m.organization.name}
      </MenuItem>
    )),
  ];
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
