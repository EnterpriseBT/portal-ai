import { sdk } from "../api/sdk";

/**
 * The include a station's page reads it with. The station page, a portal's
 * header and the app header's New portal button (#1075) read the station
 * through this one query key, so React Query fetches it once.
 */
export const STATION_PAGE_INCLUDE = "connectorInstance,curatedView";

/** What the portal says when its station can't be read (#699). */
export const STATION_UNAVAILABLE_MESSAGE =
  "This portal's station isn't available to you.";

/** What the header says when the station failed to load for another reason. */
export const STATION_LOAD_FAILED_MESSAGE =
  "Couldn't load this portal's station. Reload to try again.";

/**
 * #699: whether a station query's error means the station is gone for this
 * caller. The server answers 404 `STATION_NOT_FOUND` for a deleted station and
 * for one the caller can no longer read (#692: unreadable == absent), so both
 * read the same. Any other error (a 5xx, a proxy's 404) is not this.
 */
export function isStationUnavailable(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const { status, code } = error as { status?: unknown; code?: unknown };
  return status === 404 && code === "STATION_NOT_FOUND";
}

/**
 * #699: the portal's station, as the header and the composer both read it.
 * One hook, so they share one query key and React Query fetches it once.
 */
export function usePortalStation(stationId: string | undefined) {
  const query = sdk.stations.get(
    stationId ?? "",
    { include: STATION_PAGE_INCLUDE },
    { enabled: !!stationId }
  );
  const unavailable = !!stationId && isStationUnavailable(query.error);
  return {
    // A refetch that 404s keeps the previous data; never show it then.
    station: unavailable ? null : (query.data?.station ?? null),
    unavailable,
    loadFailed: !!query.error && !unavailable && !query.data,
    /** Still loading its first answer (#1075); false when there's no id. */
    pending: !!stationId && query.isPending,
  };
}

/**
 * #699: the portal composer's lock for an unavailable station. A send would be
 * refused with 404 `STATION_NOT_FOUND`, so the composer says why instead.
 * Another load failure doesn't lock it: that's transient, and the send decides.
 * Takes `usePortalStation`'s `unavailable`, so a caller that also reads the
 * station (#1044) subscribes to its query once.
 */
export function portalStationLock(unavailable: boolean): {
  locked: boolean;
  reason: string | null;
} {
  return {
    locked: unavailable,
    reason: unavailable ? STATION_UNAVAILABLE_MESSAGE : null,
  };
}
