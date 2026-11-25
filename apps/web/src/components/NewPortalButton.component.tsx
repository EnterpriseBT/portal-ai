import React from "react";

import { Icon, IconName, SplitButton } from "@portalai/core/ui";
import type { ActionGate, ActionMenuItem } from "@portalai/core/ui";

export interface NewPortalStation {
  id: string;
  name: string;
}

export interface NewPortalButtonUIProps {
  /** The station the main click starts a portal in; null when there's no
   *  usable one, so the main click chooses instead. */
  station: NewPortalStation | null;
  onLaunch: () => void;
  /** The current page's station, listed under "On this page". */
  pageStation?: NewPortalStation | null;
  favoriteStations: NewPortalStation[];
  onLaunchIn: (stationId: string) => void;
  onChooseStation: () => void;
  /** Whether the caller may start portals (#688), decided by the wiring. */
  gate?: ActionGate;
  /** A launch is in flight. */
  pending?: boolean;
  /** The view decides: the full label, or an icon at narrow widths. */
  layout?: "full" | "icon";
}

/**
 * The header's "New portal" split button (#1122). The main action names
 * the station it starts a portal in; its menu offers the page's station,
 * favorite stations (or how to add some) and "Choose station…".
 *
 * A gate that blocks the main action blocks every launch in the menu too,
 * since all of them create a portal.
 */
export const NewPortalButtonUI: React.FC<NewPortalButtonUIProps> = ({
  station,
  onLaunch,
  pageStation,
  favoriteStations,
  onLaunchIn,
  onChooseStation,
  gate,
  pending = false,
  layout = "full",
}) => {
  const itemGate =
    gate && (gate.kind === "disable" || gate.kind === "upsell")
      ? gate
      : undefined;
  const star = <Icon name={IconName.Star} fontSize="small" color="favorite" />;

  const menuItems: ActionMenuItem[] = [
    ...(pageStation
      ? [
          {
            label: `New portal in ${pageStation.name}`,
            section: "On this page",
            onClick: () => onLaunchIn(pageStation.id),
            gate: itemGate,
          },
        ]
      : []),
    ...(favoriteStations.length > 0
      ? favoriteStations.map((favorite) => ({
          label: favorite.name,
          section: "Favorite stations",
          icon: star,
          onClick: () => onLaunchIn(favorite.id),
          gate: itemGate,
        }))
      : [
          {
            label: "Star a station to add it here",
            section: "Favorite stations",
            hint: true,
            onClick: () => undefined,
          },
        ]),
    { label: "Choose station…", onClick: onChooseStation, gate: itemGate },
  ];

  return (
    <SplitButton
      label={station ? `New portal in ${station.name}` : "New portal"}
      onClick={station ? onLaunch : onChooseStation}
      gate={gate}
      pending={pending}
      pendingLabel="Starting…"
      icon={IconName.Add}
      menuItems={menuItems}
      menuLabel="More ways to start a portal"
      layout={layout}
      size="small"
    />
  );
};
