import { sdk } from "../api/sdk";

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
    { include: "connectorInstance,curatedView" },
    { enabled: !!stationId }
  );
  const unavailable = !!stationId && isStationUnavailable(query.error);
  return {
    // A refetch that 404s keeps the previous data; never show it then.
    station: unavailable ? null : (query.data?.station ?? null),
    unavailable,
    loadFailed: !!query.error && !unavailable && !query.data,
  };
}

/**
 * #699: the portal composer's lock for an unavailable station. A send would be
 * refused with 404 `STATION_NOT_FOUND`, so the composer says why instead.
 * Another load failure doesn't lock it: that's transient, and the send decides.
 */
export function usePortalStationLock(stationId: string | undefined): {
  locked: boolean;
  reason: string | null;
} {
  const { unavailable } = usePortalStation(stationId);
  return {
    locked: unavailable,
    reason: unavailable ? STATION_UNAVAILABLE_MESSAGE : null,
  };
}
