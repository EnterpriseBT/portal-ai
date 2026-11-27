import React, { useState } from "react";

import { sdk } from "../api/sdk";
import { usePortalLauncherContext } from "../utils/portal-launcher.context";
import { useDebouncedValue } from "../utils/use-debounced-value.util";
import { StartBoxUI } from "./StartBox.component";
import type { StationOption } from "./StationPicker.component";

/** How long typing in the station search settles before it queries. */
const STATION_SEARCH_DEBOUNCE_MS = 200;
/** How many stations a search lists. */
export const STATION_SEARCH_LIMIT = 10;

/**
 * The dashboard's start box (#1079): `StartBoxUI` wired to the shell's one
 * portal launcher, so a start shares the header's create (one in-flight
 * request, one pending state). It offers the caller's favorite stations and
 * the launcher's station, preselecting the latter, and searches every
 * station the caller can read once a query is typed.
 */
export const DashboardStartBox: React.FC = () => {
  const launcher = usePortalLauncherContext();
  // The launcher outlives the dashboard, so its last start-box error would
  // greet the box when the dashboard is opened again (#1137 code review).
  // The box shows one only after a start from this visit.
  const [started, setStarted] = useState(false);
  const handleStart: typeof launcher.startBox.onStart = (body) => {
    setStarted(true);
    launcher.startBox.onStart(body);
  };

  const [query, setQuery] = useState("");
  // Cleared at once, so an emptied field never shows an older search.
  const debounced = useDebouncedValue(query, STATION_SEARCH_DEBOUNCE_MS, {
    immediate: query.trim() === "",
  }).trim();
  const search = sdk.stations.list(
    {
      search: debounced,
      limit: STATION_SEARCH_LIMIT,
      offset: 0,
      sortBy: "name",
      sortOrder: "asc",
    },
    { enabled: debounced !== "" }
  );

  const favorites: StationOption[] = launcher.favoriteStations.map((s) => ({
    ...s,
    favorite: true,
  }));
  const { station } = launcher;
  const stations =
    station && !favorites.some((s) => s.id === station.id)
      ? [...favorites, { ...station, favorite: false }]
      : favorites;
  const favoriteIds = new Set(favorites.map((s) => s.id));
  const results: StationOption[] =
    debounced === ""
      ? []
      : (search.data?.stations ?? []).map((row) => ({
          id: row.id,
          name: row.name,
          favorite: favoriteIds.has(row.id),
        }));

  return (
    <StartBoxUI
      stations={stations}
      initialStationId={station?.id ?? null}
      gate={launcher.gate}
      pending={launcher.pending}
      serverError={started ? launcher.startBox.serverError : null}
      onStart={handleStart}
      stationSearch={{
        query,
        onQueryChange: setQuery,
        results,
        // Typed but not yet settled counts as searching, too.
        searching:
          query.trim() !== "" &&
          (query.trim() !== debounced || search.isFetching),
      }}
    />
  );
};
