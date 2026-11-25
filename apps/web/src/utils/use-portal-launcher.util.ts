import { useCallback } from "react";

import { useNavigate, useRouterState } from "@tanstack/react-router";
import type { ActionGate } from "@portalai/core/ui";

import { queryKeys, sdk } from "../api/sdk";
import { useCreateGate } from "./use-create-gate.util";
import type { NewPortalStation } from "../components/NewPortalButton.component";

/** The include the station page reads with, so its query is shared. */
export const STATION_PAGE_INCLUDE = "connectorInstance,curatedView";

/** How many favorite stations the menu lists. */
export const FAVORITE_STATIONS_LIMIT = 20;

/** The station a path belongs to: `/stations/:id` and anything under it. */
export function stationIdFromPath(pathname: string): string | undefined {
  const match = /^\/stations\/([^/]+)/.exec(pathname);
  return match ? decodeURIComponent(match[1]) : undefined;
}

/**
 * The main click's station (#1075): the page's, else the last-used one,
 * else the first favorite, else none. While a source ahead of a fallback is
 * still loading (`settling`), it names none rather than naming a fallback
 * and then switching.
 */
export function pickLaunchStation({
  pageStation,
  lastStation,
  favoriteStations,
  settling,
}: {
  pageStation: NewPortalStation | null;
  lastStation: NewPortalStation | null;
  favoriteStations: NewPortalStation[];
  settling: boolean;
}): NewPortalStation | null {
  if (pageStation) return pageStation;
  if (settling) return null;
  return lastStation ?? favoriteStations[0] ?? null;
}

export interface PortalLauncher {
  /** The station the main click starts a portal in, or null to choose. */
  station: NewPortalStation | null;
  /** The current page's station, on a station's page. */
  pageStation: NewPortalStation | null;
  favoriteStations: NewPortalStation[];
  gate: ActionGate;
  pending: boolean;
  /** Starts a portal in the station and opens it; a failure toasts. */
  launch: (stationId: string) => void;
}

/**
 * The header's New portal launcher (#1075): which stations to offer, the
 * gate, and the launch. The main click's station is, in order: the page's
 * station; the station of the caller's last-opened portal, if they can
 * still read it (a deleted or unshared one 404s and is skipped); their
 * first favorite station; else none, so the click chooses. #1114 removed
 * the org's default station, which this replaces.
 */
export function usePortalLauncher(): PortalLauncher {
  const navigate = useNavigate();
  // The location, not the match: a route match isn't there off-route (the
  // shared test router registers no file routes), and the header renders
  // above every page anyway.
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const pageStationId = stationIdFromPath(pathname);

  const pageQuery = sdk.stations.get(
    pageStationId ?? "",
    { include: STATION_PAGE_INCLUDE },
    { enabled: Boolean(pageStationId) }
  );
  const pageRow = pageStationId ? pageQuery.data?.station : undefined;
  const pageStation = pageRow ? { id: pageRow.id, name: pageRow.name } : null;

  const recent = sdk.portals.list({
    limit: 1,
    offset: 0,
    sortBy: "lastOpened",
    sortOrder: "desc",
    include: "station",
  });
  const lastStationId = recent.data?.portals[0]?.stationId;
  // Confirms the last-used station is still readable; a 404 is final, so
  // it isn't retried before falling through.
  const lastQuery = sdk.stations.get(lastStationId ?? "", undefined, {
    enabled: Boolean(lastStationId),
    retry: false,
  });
  const lastRow = lastStationId ? lastQuery.data?.station : undefined;
  const lastStation = lastRow ? { id: lastRow.id, name: lastRow.name } : null;

  const favorites = sdk.stations.list({
    favorite: "true",
    sortBy: "name",
    sortOrder: "asc",
    limit: FAVORITE_STATIONS_LIMIT,
    offset: 0,
  });
  const favoriteStations = (favorites.data?.stations ?? []).map((row) => ({
    id: row.id,
    name: row.name,
  }));

  const gate = useCreateGate("portal", "Ask for access to start portals");
  const create = sdk.portals.create();

  const launch = useCallback(
    (stationId: string) => {
      create.mutate(
        { stationId },
        {
          invalidate: [queryKeys.portals.root],
          toast: { error: "Couldn't start the portal." },
          onSuccess: (data) => {
            navigate({ to: `/portals/${data.portal.id}` });
          },
        }
      );
    },
    [create, navigate]
  );

  // A query that's disabled reads as pending, so each counts only when
  // it's enabled.
  const settling =
    (Boolean(pageStationId) && pageQuery.isPending) ||
    recent.isPending ||
    (Boolean(lastStationId) && lastQuery.isPending);
  const station = pickLaunchStation({
    pageStation,
    lastStation,
    favoriteStations,
    settling,
  });

  return {
    station,
    pageStation,
    favoriteStations,
    gate,
    pending: create.isPending,
    launch,
  };
}
