import React from "react";

import { GatedIconButton, IconName, pendingGate } from "@portalai/core/ui";
import type { FavoriteTarget } from "@portalai/core/models";

import { sdk } from "../api/sdk";
import { favoriteKeys } from "../utils/favorite-invalidation.util";

export interface FavoriteToggleUIProps {
  /** The object's name, so the button names its row ("Favorite {name}"). */
  name: string;
  isFavorite: boolean;
  /** A favorite change is in flight: the button stays focused but waits. */
  pending: boolean;
  onToggle: () => void;
}

/**
 * #1072: the star on a station, pinned result, view or connector. A toggle
 * button: `aria-pressed` says whether it's a favorite, and its name says
 * what pressing it does to which object.
 */
export const FavoriteToggleUI: React.FC<FavoriteToggleUIProps> = ({
  name,
  isFavorite,
  pending,
  onToggle,
}) => (
  <GatedIconButton
    icon={isFavorite ? IconName.Star : IconName.StarBorder}
    size="small"
    aria-pressed={isFavorite}
    aria-label={`${isFavorite ? "Unfavorite" : "Favorite"} ${name}`}
    gate={pendingGate(pending)}
    onClick={onToggle}
  />
);

export interface FavoriteToggleProps {
  target: FavoriteTarget;
  name: string;
  isFavorite: boolean;
}

/**
 * Stars and unstars through the SDK. The star shows the server's answer:
 * the call refreshes the object's type (lists and detail) instead of
 * patching the cache, and a failure raises a toast.
 */
export const FavoriteToggle: React.FC<FavoriteToggleProps> = ({
  target,
  name,
  isFavorite,
}) => {
  const { mutate: set, isPending: setting } = sdk.favorites.set();
  const { mutate: unset, isPending: unsetting } = sdk.favorites.unset();

  const handleToggle = () =>
    (isFavorite ? unset : set)(target, {
      invalidate: favoriteKeys(target.type),
      toast: {
        error: isFavorite
          ? "Couldn't remove the favorite."
          : "Couldn't add the favorite.",
      },
    });

  return (
    <FavoriteToggleUI
      name={name}
      isFavorite={isFavorite}
      pending={setting || unsetting}
      onToggle={handleToggle}
    />
  );
};
