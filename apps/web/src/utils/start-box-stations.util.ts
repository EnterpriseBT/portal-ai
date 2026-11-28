import type { StationOption } from "../components/StationPicker.component";

/** How many stations an empty search suggests. */
export const SUGGESTED_STATIONS_LIMIT = 5;

/** The suggestion groups' headings, in the order they're listed. */
/** The heading a station picked from search sits under when it isn't among
 *  the suggestions, so the list still says why it's there. Listed last. */
export const PICKED_STATION_GROUP = "Selected station";

export const STATION_SUGGESTION_GROUPS = {
  recent: "Recent stations",
  favorite: "Favorite stations",
  newest: "More stations",
} as const;

const GROUP_ORDER: string[] = [
  STATION_SUGGESTION_GROUPS.recent,
  STATION_SUGGESTION_GROUPS.favorite,
  STATION_SUGGESTION_GROUPS.newest,
];

type NamedStation = { id: string; name: string };

/**
 * The stations the start box suggests before anything is typed (#1079),
 * grouped by why each is listed, as the header's Open Portal menu groups:
 * 1. "Recent stations": those of the caller's most recently opened portals;
 * 2. "Favorite stations": their favorites;
 * 3. "More stations": the org's newest stations.
 *
 * Each station is listed once, under the first group it falls in (a
 * favorite that's also recent sits under Recent, still starred), and at most
 * `limit` are suggested. `keep` (the preselected station) is added when it
 * isn't among them, under Favorite stations if starred and Recent stations
 * otherwise (the launcher's station is the one used last), so the box never
 * preselects a station it doesn't list. A recent portal whose station has no
 * name (unreadable or deleted) is skipped.
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
  const candidates: (NamedStation & { group: string })[] = [
    ...recentPortals.flatMap((p) =>
      p.stationName
        ? [
            {
              id: p.stationId,
              name: p.stationName,
              group: STATION_SUGGESTION_GROUPS.recent,
            },
          ]
        : []
    ),
    ...favorites.map((s) => ({
      ...s,
      group: STATION_SUGGESTION_GROUPS.favorite,
    })),
    ...newest.map((s) => ({ ...s, group: STATION_SUGGESTION_GROUPS.newest })),
  ];

  const seen = new Set<string>();
  const suggested: StationOption[] = [];
  for (const candidate of candidates) {
    if (suggested.length >= limit) break;
    if (seen.has(candidate.id)) continue;
    seen.add(candidate.id);
    suggested.push({ ...candidate, favorite: favoriteIds.has(candidate.id) });
  }
  if (keep && !seen.has(keep.id)) {
    const favorite = favoriteIds.has(keep.id);
    suggested.push({
      ...keep,
      favorite,
      group: favorite
        ? STATION_SUGGESTION_GROUPS.favorite
        : STATION_SUGGESTION_GROUPS.recent,
    });
  }
  // Groups stay together, in their order (a stable sort keeps each group's
  // own order).
  const rank = (option: StationOption) =>
    GROUP_ORDER.indexOf(option.group ?? "");
  return suggested.sort((a, b) => rank(a) - rank(b));
}
