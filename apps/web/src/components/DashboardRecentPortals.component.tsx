import React from "react";

import { EmptyState, Icon, IconName, LinkList } from "@portalai/core/ui";
import { DateFactory } from "@portalai/core/utils";

import { RouterLink } from "./RouterLink.component";

/** A portal row on the dashboard. */
export interface DashboardRecentPortal {
  id: string;
  name: string;
  stationName?: string | null;
  created: number;
  lastOpened: number | null;
}

/** How many portals the dashboard shows. It has no "see all". */
export const DASHBOARD_RECENT_PORTALS_MAX = 5;

export interface DashboardRecentPortalsUIProps {
  /** Most recent first. Only the first five are shown. */
  portals: DashboardRecentPortal[];
}

/**
 * The dashboard's short Recent portals list (#1123): one line per portal,
 * its name linking to it, with its station and when it was last opened at
 * the trailing edge, or a teaching empty state.
 */
export const DashboardRecentPortalsUI: React.FC<
  DashboardRecentPortalsUIProps
> = ({ portals }) => {
  if (portals.length === 0) {
    return (
      <EmptyState
        icon={<Icon name={IconName.Portal} />}
        title="No portals yet"
        description="A portal is a conversation with a station's data. Ask a question above, or launch a favorite station, to start one."
      />
    );
  }

  return (
    <LinkList
      aria-label="Recent portals"
      linkComponent={RouterLink}
      items={portals.slice(0, DASHBOARD_RECENT_PORTALS_MAX).map((portal) => ({
        id: portal.id,
        href: `/portals/${portal.id}`,
        primary: portal.name,
        secondary: [
          portal.stationName,
          DateFactory.relativeTime(portal.lastOpened ?? portal.created),
        ]
          .filter(Boolean)
          .join(" · "),
      }))}
    />
  );
};
