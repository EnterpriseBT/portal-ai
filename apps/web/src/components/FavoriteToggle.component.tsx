import React, { useState } from "react";

import { useQueryClient } from "@tanstack/react-query";

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
 * button (APG): its name stays "Favorite {name}" and `aria-pressed` says
 * whether it's on, so the state is announced once and never contradicts the
 * name.
 */
export const FavoriteToggleUI: React.FC<FavoriteToggleUIProps> = ({
  name,
  isFavorite,
  pending,
  onToggle,
}) => (
  <GatedIconButton
    icon={isFavorite ? IconName.Star : IconName.StarBorder}
    // A favorite's star is the brand yellow (palette.favorite, held at 3:1
    // in both themes); an unstarred outline stays neutral.
    color={isFavorite ? "favorite" : "default"}
    size="small"
    aria-pressed={isFavorite}
    aria-label={`Favorite ${name}`}
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
 * the call refreshes the object's lists and detail read instead of patching
 * the cache. The button stays pending until that refetch lands, so a second
 * click always acts on the new state (code review: a click between the
 * write and the refetch repeated the write instead of undoing it).
 */
export const FavoriteToggle: React.FC<FavoriteToggleProps> = ({
  target,
  name,
  isFavorite,
}) => {
  const queryClient = useQueryClient();
  const { mutateAsync: set } = sdk.favorites.set();
  const { mutateAsync: unset } = sdk.favorites.unset();
  const [pending, setPending] = useState(false);

  const handleToggle = async () => {
    if (pending) return;
    setPending(true);
    const keys = favoriteKeys(target);
    try {
      // `invalidate` refreshes even if this unmounts first (#970); the wait
      // below joins that refetch rather than starting another.
      await (isFavorite ? unset : set)(target, {
        invalidate: keys,
        toast: {
          error: isFavorite
            ? "Couldn't remove the favorite."
            : "Couldn't add the favorite.",
        },
      });
      await Promise.all(
        keys.map((queryKey) =>
          queryClient.refetchQueries(
            { queryKey, type: "active" },
            { cancelRefetch: false }
          )
        )
      );
    } catch {
      // The call's toast reported it.
    } finally {
      setPending(false);
    }
  };

  return (
    <FavoriteToggleUI
      name={name}
      isFavorite={isFavorite}
      pending={pending}
      onToggle={() => void handleToggle()}
    />
  );
};
