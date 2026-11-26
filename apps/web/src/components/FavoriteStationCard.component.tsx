import React from "react";

import {
  DetailCard,
  Icon,
  IconName,
  Stack,
  Typography,
  pendingGate,
  type ActionGate,
  type ActionSuiteItem,
} from "@portalai/core/ui";
import { DateFactory } from "@portalai/core/utils";

import { RouterLink } from "./RouterLink.component";

/** One favorite station on the dashboard. */
export interface FavoriteStationItem {
  station: { id: string; name: string; description?: string | null };
  /** When the caller last opened a portal in it (epoch ms), or null. */
  lastActivity: number | null;
  /** Whether the caller may launch a portal here. Omitted = allow. */
  launchGate?: ActionGate;
  /** A launch from this card is in flight. */
  launching?: boolean;
}

export interface FavoriteStationCardUIProps extends FavoriteStationItem {
  onLaunch: (stationId: string) => void;
}

/**
 * A favorite station on the dashboard (#1123). Its title links to the
 * station; Launch starts a portal there. Launch is described by the card's
 * title, so it's heard as launching this station.
 */
export const FavoriteStationCardUI: React.FC<FavoriteStationCardUIProps> = ({
  station,
  lastActivity,
  launchGate,
  launching = false,
  onLaunch,
}) => {
  const actions: ActionSuiteItem[] = [
    {
      label: "Launch",
      icon: <Icon name={IconName.RocketLaunch} />,
      variant: "contained",
      onClick: () => onLaunch(station.id),
      gate:
        launchGate && launchGate.kind !== "allow"
          ? launchGate
          : pendingGate(launching, "Launching…"),
    },
  ];

  return (
    <DetailCard
      title={station.name}
      icon={<Icon name={IconName.SatelliteAlt} />}
      href={`/stations/${station.id}`}
      linkComponent={RouterLink}
      headingLevel={3}
      actions={actions}
      data-testid={`favorite-station-${station.id}`}
    >
      <Stack spacing={0.25}>
        {station.description && (
          <Typography variant="body2" color="text.secondary">
            {station.description}
          </Typography>
        )}
        <Typography variant="caption" color="text.secondary">
          {lastActivity === null
            ? "No portals yet"
            : `Last portal ${DateFactory.relativeTime(lastActivity)}`}
        </Typography>
      </Stack>
    </DetailCard>
  );
};
