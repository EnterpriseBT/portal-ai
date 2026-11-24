import React from "react";

import { EmptyState, Icon, IconName } from "@portalai/core/ui";

import { emptyListHelp } from "../utils/empty-list-help.util";

export interface FavoritesEmptyResultsProps {
  /** What the list holds, singular ("station", "view"). */
  noun: string;
}

/**
 * #1072: a list's Favorites toggle with nothing starred. It says how
 * to star an item and links to the Help entry on favorites.
 */
export const FavoritesEmptyResults: React.FC<FavoritesEmptyResultsProps> = ({
  noun,
}) => (
  <EmptyState
    icon={<Icon name={IconName.StarBorder} />}
    title="No favorites yet"
    {...emptyListHelp("favorites")}
    description={`Star a ${noun} to keep it here. Only you see your favorites.`}
  />
);
