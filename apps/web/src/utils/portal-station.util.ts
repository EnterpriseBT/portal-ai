import { sdk } from "../api/sdk";

/** What the portal says when its station can't be read (#699). */
export const STATION_UNAVAILABLE_MESSAGE =
  "This portal's station isn't available to you.";

/**
 * #699: whether a station query's error means the station is gone for this
 * caller. The server answers 404 for a deleted station and for one the caller
 * can no longer read (#692: unreadable == absent), so both read the same.
 */
export function isStationUnavailable(error: unknown): boolean {
  return (
    !!error &&
    typeof error === "object" &&
    (error as { status?: unknown }).status === 404
  );
}

/**
 * #699: the portal composer's lock for an unavailable station. Reads the same
 * station query the header does (same key and include, so React Query dedupes
 * it). A send would be refused with 404 `STATION_NOT_FOUND`, so the composer
 * says why instead.
 */
export function usePortalStationLock(stationId: string | undefined): {
  locked: boolean;
  reason: string | null;
} {
  const { error } = sdk.stations.get(
    stationId ?? "",
    { include: "connectorInstance,curatedView" },
    { enabled: !!stationId }
  );
  const locked = !!stationId && isStationUnavailable(error);
  return { locked, reason: locked ? STATION_UNAVAILABLE_MESSAGE : null };
}
