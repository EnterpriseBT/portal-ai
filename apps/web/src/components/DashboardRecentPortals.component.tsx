import React from "react";

import {
  CardList,
  DetailCard,
  EmptyState,
  Icon,
  IconName,
  Stack,
  Typography,
} from "@portalai/core/ui";
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
 * The dashboard's short Recent portals list (#1123): the few most recent
 * portals, each with its station, or a teaching empty state.
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
    <CardList aria-label="Recent portals">
      {portals.slice(0, DASHBOARD_RECENT_PORTALS_MAX).map((portal) => (
        <DetailCard
          key={portal.id}
          title={portal.name}
          href={`/portals/${portal.id}`}
          linkComponent={RouterLink}
          headingLevel={3}
          data-testid={`recent-portal-${portal.id}`}
        >
          <Stack spacing={0.25}>
            {portal.stationName && (
              <Stack direction="row" spacing={0.5} alignItems="center">
                <Icon name={IconName.SatelliteAlt} fontSize="inherit" />
                <Typography variant="caption" color="text.secondary">
                  {portal.stationName}
                </Typography>
              </Stack>
            )}
            <Typography variant="caption" color="text.secondary">
              {DateFactory.relativeTime(portal.lastOpened ?? portal.created)}
            </Typography>
          </Stack>
        </DetailCard>
      ))}
    </CardList>
  );
};
