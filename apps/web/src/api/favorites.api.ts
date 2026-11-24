import type { FavoriteResponsePayload } from "@portalai/core/contracts";
import type { FavoriteTarget } from "@portalai/core/models";

import { useAuthMutation } from "../utils/api.util";
import { favoriteKeys } from "../utils/favorite-invalidation.util";

/**
 * Favorites (#1072): the caller's personal star on a station, pin, view or
 * connector. Both calls are idempotent and need only read on the object; a
 * 404 means it's gone or no longer readable, so its type refetches.
 */
export const favorites = {
  set: () =>
    useAuthMutation<FavoriteResponsePayload, FavoriteTarget>({
      url: ({ type, id }) => `/api/favorites/${type}/${encodeURIComponent(id)}`,
      method: "PUT",
      body: () => undefined,
      onPermissionDenied: { invalidate: (target) => favoriteKeys(target.type) },
    }),

  unset: () =>
    useAuthMutation<FavoriteResponsePayload, FavoriteTarget>({
      url: ({ type, id }) => `/api/favorites/${type}/${encodeURIComponent(id)}`,
      method: "DELETE",
      body: () => undefined,
      onPermissionDenied: { invalidate: (target) => favoriteKeys(target.type) },
    }),
};
