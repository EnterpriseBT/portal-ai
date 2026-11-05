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
  /** Set by MUI's MenuList on its first child when the menu opens. This
   *  component is that child, so it hands them to the current org's item;
   *  dropped, no item would take focus and the arrow keys would do nothing
   *  (#797 review). */
  autoFocus?: boolean;
  tabIndex?: number;
}

/**
 * Pure UI: the account menu's organization indicator + switcher (#201),
 * following the APG menu-radio pattern (#797).
 *
 * - 0 orgs → nothing.
 * - 1+ orgs → one `menuitemradio` per org, the current one checked (with
 *   several, under a visual "Organization" label). Choosing another org
 *   switches; choosing the current one does nothing. The account menu
 *   closes on the click, as for any of its items, so `isSwitching` is
 *   rarely seen there; the switch's outcome shows in the page reloading its
 *   data. A `Select` inside a menu broke the pattern: a combobox isn't a
 *   menu item.
 */
export const OrgSwitcherUI: React.FC<OrgSwitcherUIProps> = ({
  memberships,
  onSwitch,
  isSwitching,
  autoFocus,
  tabIndex,
}) => {
  if (memberships.length === 0) {
    return null;
  }

  const items = memberships.map((m) => (
    <MenuItem
      key={m.organization.id}
      role="menuitemradio"
      aria-checked={m.isCurrent}
      selected={m.isCurrent}
      disabled={isSwitching}
      autoFocus={m.isCurrent ? autoFocus : undefined}
      tabIndex={m.isCurrent ? tabIndex : undefined}
      onClick={() => {
        if (!m.isCurrent) onSwitch(m.organization.id);
      }}
    >
      {m.organization.name}
    </MenuItem>
  ));

  if (memberships.length === 1) return items;

  return [
    // A visual group label. A menu may only own menu items, groups and
    // separators, and each radio already names its org, so it's hidden
    // from assistive tech.
    <ListSubheader key="label" aria-hidden sx={{ lineHeight: 2.5 }}>
      Organization
    </ListSubheader>,
    ...items,
  ];
};

/**
 * Container: reads the user's memberships and wires the switch mutation.
 * On success it invalidates the ENTIRE query cache — after an org change
 * essentially all cached data is stale (every org-scoped query resolves
 * against the request's current org). The rare legitimate broad
 * invalidation. (#201)
 */
export const OrgSwitcher: React.FC<
  Pick<OrgSwitcherUIProps, "autoFocus" | "tabIndex">
> = ({ autoFocus, tabIndex }) => {
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
      autoFocus={autoFocus}
      tabIndex={tabIndex}
    />
  );
};
