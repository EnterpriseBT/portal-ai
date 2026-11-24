import type { FavoriteTarget } from "@portalai/core/models";

import { queryKeys } from "../api/keys";

/**
 * #1072: what a favorite change refreshes: its type's lists (whose rows carry
 * `isFavorite` and honor `favorite=true`) and that object's detail read.
 * Narrower than the type's root, which also holds data a star never changes
 * (a pin's live data, a view's records). Each key is a prefix.
 */
export function favoriteKeys({ type, id }: FavoriteTarget) {
  switch (type) {
    case "station":
      return [
        [...queryKeys.stations.root, "list"],
        [...queryKeys.stations.root, "get", id],
      ];
    case "pin":
      return [
        [...queryKeys.portalResults.root, "list"],
        queryKeys.portalResults.get(id),
      ];
    case "curated_view":
      return [
        [...queryKeys.curatedViews.root, "list"],
        queryKeys.curatedViews.get(id),
      ];
    case "connector_instance":
      return [
        [...queryKeys.connectorInstances.root, "list"],
        queryKeys.connectorInstances.get(id),
      ];
  }
}
