import React from "react";
import {
  MenuItem,
  ListItemIcon,
  ListItemText,
  Icon,
  IconName,
  Typography,
  Box,
} from "@portalai/core/ui";
import { useQueryClient } from "@tanstack/react-query";

import { sdk } from "../api/sdk";

import type { UserMembership } from "@portalai/core/contracts";

export interface OrgSwitcherUIProps {
  memberships: UserMembership[];
  onSwitch: (organizationId: string) => void;
  isSwitching?: boolean;
}

/**
 * Pure UI: a labelled section of the account menu listing the user's orgs,
 * the current one checked. Renders NOTHING when the user belongs to fewer
 * than two orgs — no affordance to switch when there's nowhere to go. Drops
 * into the existing account `<Menu>` as children (props-only, no context).
 */
export const OrgSwitcherUI: React.FC<OrgSwitcherUIProps> = ({
  memberships,
  onSwitch,
  isSwitching,
}) => {
  if (memberships.length < 2) {
    return null;
  }

  return (
    <Box>
      <Typography
        variant="subtitle2"
        sx={(theme) => ({
          color: theme.palette.text.secondary,
          padding: theme.spacing(1, 2),
        })}
      >
        Switch organization
      </Typography>
      {memberships.map(({ organization, isCurrent }) => {
        const locked = isSwitching || isCurrent;
        return (
        <MenuItem
          key={organization.id}
          selected={isCurrent}
          disabled={locked}
          // Guard in the handler too — a disabled MUI MenuItem only blocks
          // clicks via `pointer-events: none` (CSS), so belt-and-braces.
          onClick={() => {
            if (!locked) onSwitch(organization.id);
          }}
          aria-label={`Switch to ${organization.name}`}
        >
          <ListItemIcon>
            {isCurrent && <Icon name={IconName.Check} fontSize="small" />}
          </ListItemIcon>
          <ListItemText>{organization.name}</ListItemText>
        </MenuItem>
        );
      })}
    </Box>
  );
};

/**
 * Container: reads the user's memberships and wires the switch mutation.
 * On success it invalidates the ENTIRE query cache — after an org change
 * essentially all cached data is stale (every org-scoped query resolves
 * against the request's current org). This is the rare legitimate broad
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
