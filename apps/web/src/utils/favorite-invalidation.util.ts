import type { FavoriteTargetType } from "@portalai/core/models";

import { queryKeys } from "../api/keys";

/**
 * #1072: what a favorite change refreshes: its type's root key, which holds
 * both the lists (whose rows carry `isFavorite` and honor `favorite=true`)
 * and the object's detail read.
 */
export function favoriteKeys(type: FavoriteTargetType) {
  switch (type) {
    case "station":
      return [queryKeys.stations.root];
    case "pin":
      return [queryKeys.portalResults.root];
    case "curated_view":
      return [queryKeys.curatedViews.root];
    case "connector_instance":
      return [queryKeys.connectorInstances.root];
  }
}
