import React from "react";

import { CardList, EmptyState, Icon, IconName } from "@portalai/core/ui";

import { PinTileUI, type PinTileStatus } from "./PinTile.component";
import { emptyListHelp } from "../utils/empty-list-help.util";

/** One favorite pin and the state of its content. */
export interface FavoritePinItem {
  pin: { id: string; title: string };
  status: PinTileStatus;
  content?: React.ReactNode;
}

/** How many pins the dashboard shows by default. */
export const FAVORITE_PINS_MAX = 6;

export interface FavoritePinsUIProps {
  pins: FavoritePinItem[];
  /** At most this many tiles are shown. */
  max?: number;
  onRetry?: (pinId: string) => void;
}

/**
 * The dashboard's favorite pins (#1123): a tile per starred pin, up to
 * `max` and up to three across on a wide screen, or a teaching empty state saying how to add one.
 */
export const FavoritePinsUI: React.FC<FavoritePinsUIProps> = ({
  pins,
  max = FAVORITE_PINS_MAX,
  onRetry,
}) => {
  if (pins.length === 0) {
    return (
      <EmptyState
        icon={<Icon name={IconName.PushPin} />}
        title="No favorite pins yet"
        {...emptyListHelp("favorites")}
        description="Star a pinned result on the Pinned results page to keep it on your dashboard."
      />
    );
  }

  return (
    <CardList aria-label="Favorite pins" columns={{ xs: 1, sm: 2, md: 3 }}>
      {pins.slice(0, max).map((item) => (
        <PinTileUI
          key={item.pin.id}
          pin={item.pin}
          status={item.status}
          onRetry={onRetry}
        >
          {item.content}
        </PinTileUI>
      ))}
    </CardList>
  );
};
