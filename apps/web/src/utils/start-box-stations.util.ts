import type { StationOption } from "../components/StationPicker.component";

/** How many stations an empty search suggests. */
export const SUGGESTED_STATIONS_LIMIT = 5;

type NamedStation = { id: string; name: string };

/**
 * The stations the start box suggests before anything is typed (#1079), in
 * order:
 * 1. the stations of the caller's most recently opened portals;
 * 2. their favorite stations;
 * 3. the org's newest stations.
 *
 * Each station is listed once, at its first place, and at most `limit` are
 * suggested. `keep` (the preselected station) is added after them when it
 * isn't among them, so the box never preselects a station it doesn't list.
 * A recent portal whose station has no name (deleted) is skipped.
 */
export function suggestStations({
  recentPortals,
  favorites,
  newest,
  keep,
  limit = SUGGESTED_STATIONS_LIMIT,
}: {
  recentPortals: { stationId: string; stationName?: string | null }[];
  favorites: NamedStation[];
  newest: NamedStation[];
  keep: NamedStation | null;
  limit?: number;
}): StationOption[] {
  const favoriteIds = new Set(favorites.map((s) => s.id));
  const ordered: NamedStation[] = [
    ...recentPortals.flatMap((p) =>
      p.stationName ? [{ id: p.stationId, name: p.stationName }] : []
    ),
    ...favorites,
    ...newest,
  ];
  const seen = new Set<string>();
  const suggested: StationOption[] = [];
  for (const station of ordered) {
    if (suggested.length >= limit) break;
    if (seen.has(station.id)) continue;
    seen.add(station.id);
    suggested.push({
      id: station.id,
      name: station.name,
      favorite: favoriteIds.has(station.id),
    });
  }
  if (keep && !suggested.some((s) => s.id === keep.id)) {
    suggested.push({ ...keep, favorite: favoriteIds.has(keep.id) });
  }
  return suggested;
}
