import React from "react";

import { CardList, EmptyState, Icon, IconName } from "@portalai/core/ui";

import {
  FavoriteStationCardUI,
  type FavoriteStationItem,
} from "./FavoriteStationCard.component";
import { emptyListHelp } from "../utils/empty-list-help.util";

export interface FavoriteStationsUIProps {
  items: FavoriteStationItem[];
  onLaunch: (stationId: string) => void;
}

/**
 * The dashboard's favorite stations (#1123): one card per starred station,
 * or, with none starred, a teaching empty state saying how to add one.
 */
export const FavoriteStationsUI: React.FC<FavoriteStationsUIProps> = ({
  items,
  onLaunch,
}) => {
  if (items.length === 0) {
    return (
      <EmptyState
        icon={<Icon name={IconName.StarBorder} />}
        title="No favorite stations yet"
        {...emptyListHelp("favorites")}
        description="Star a station on the Stations page to launch it from here in one click."
      />
    );
  }

  return (
    <CardList aria-label="Favorite stations">
      {items.map((item) => (
        <FavoriteStationCardUI
          key={item.station.id}
          {...item}
          onLaunch={onLaunch}
        />
      ))}
    </CardList>
  );
};
