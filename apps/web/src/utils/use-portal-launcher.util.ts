import { useState } from "react";

import { useNavigate, useRouterState } from "@tanstack/react-router";
import type {
  CreatePortalBody,
  StartPortalBody,
} from "@portalai/core/contracts";
import type { ActionGate } from "@portalai/core/ui";

import { queryKeys, sdk } from "../api/sdk";
import { toServerError, type ServerError } from "./api.util";
import { rememberPendingFirstTurn } from "./portal-initial-message.util";
import { RECENT_PORTALS_PARAMS } from "./portal-launcher.context";
import { usePortalStation } from "./portal-station.util";
import { useCreateGate } from "./use-create-gate.util";
import type { NewPortalStation } from "../components/NewPortalButton.component";

/** How many favorite stations the menu lists. */
export const FAVORITE_STATIONS_LIMIT = 20;

/** The main action's reason while its station is still being worked out. */
export const LAUNCHER_SETTLING_REASON = "Finding your station…";

/**
 * The station a path belongs to: `/stations/:id` and anything under it. A
 * malformed escape in the address isn't a station, rather than an error in
 * the header on every page.
 */
export function stationIdFromPath(pathname: string): string | undefined {
  const match = /^\/stations\/([^/]+)/.exec(pathname);
  if (!match) return undefined;
  try {
    return decodeURIComponent(match[1]);
  } catch {
    return undefined;
  }
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

const asStation = (
  row: { id: string; name: string } | null
): NewPortalStation | null => (row ? { id: row.id, name: row.name } : null);

export interface PortalLauncher {
  /** The station the main click starts a portal in, or null to choose. */
  station: NewPortalStation | null;
  /** The current page's station, on a station's page. */
  pageStation: NewPortalStation | null;
  favoriteStations: NewPortalStation[];
  /** The main action's station is still being worked out. */
  settling: boolean;
  gate: ActionGate;
  /** A create is in flight, from any of the launcher's paths. */
  pending: boolean;
  /** Starts a portal in the station and opens it; a failure toasts. */
  launch: (stationId: string) => void;
  /** "Choose station…": the dialog's state, sharing the one create. */
  chooser: {
    open: boolean;
    onOpen: () => void;
    onClose: () => void;
    onSubmit: (body: CreatePortalBody) => void;
    serverError: ServerError | null;
  };
  /** #1079: the dashboard's start box, sharing the one create. */
  startBox: {
    /** Starts a portal with its first question. Errors show in the box. */
    onStart: (body: StartPortalBody) => void;
    /** The last start-box create's error, else null. */
    serverError: ServerError | null;
  };
}

/** Which of the launcher's paths submitted the latest create (#1079). */
type LaunchSurface = "launch" | "chooser" | "startBox";

/**
 * The header's Open Portal launcher (#1075): which stations to offer, the
 * gate, and the launch. The main click's station is, in order:
 * - the page's station;
 * - the station of the caller's own last-opened portal (`mine=true`), if
 *   they can still read it (a deleted or unshared one 404s and is skipped,
 *   even after a refetch that keeps the old data);
 * - their first favorite station;
 * - else none, so the click chooses.
 * #1114 removed the org's default station, which this replaces. One create
 * serves every path, so a double click across them still sends one request.
 */
export function usePortalLauncher(): PortalLauncher {
  const navigate = useNavigate();
  // The location, not the match: a route match isn't there off-route (the
  // shared test router registers no file routes), and the header renders
  // above every page anyway.
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const pageStationId = stationIdFromPath(pathname);
  const page = usePortalStation(pageStationId);

  const recent = sdk.portals.list(RECENT_PORTALS_PARAMS);
  const lastStationId = recent.data?.portals[0]?.stationId;
  const last = usePortalStation(lastStationId);

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

  const pageStation = asStation(page.station);
  const settling =
    page.pending || recent.isPending || last.pending || favorites.isPending;
  const station = pickLaunchStation({
    pageStation,
    lastStation: asStation(last.station),
    favoriteStations,
    settling,
  });

  const gate = useCreateGate("portal", "Ask for access to start portals");

  const create = sdk.portals.create();
  const [chooserOpen, setChooserOpen] = useState(false);
  const [surface, setSurface] = useState<LaunchSurface | null>(null);

  // Plain functions: the React Compiler memoizes them, and the mutation's
  // result object changes every render, so a hand-written useCallback over
  // it never held (#1075 code review).
  const start = (body: CreatePortalBody, from: LaunchSurface) => {
    setSurface(from);
    const request = create.mutateAsync(body, {
      invalidate: [queryKeys.portals.root],
      // The chooser and the start box show a failure beside their fields;
      // the main click has nowhere to, so it toasts.
      ...(from === "launch"
        ? { toast: { error: "Couldn't start the portal." } }
        : {}),
      onSuccess: (data) => {
        setChooserOpen(false);
        const outcome = data.initialMessage;
        // #1079: the portal opens knowing its first question's outcome: an
        // admitted one is answered there, and a refused one (the portal was
        // still created) goes back in its composer.
        navigate({
          to: `/portals/${data.portal.id}`,
          ...(outcome?.status === "pending"
            ? { state: { pendingInitialMessage: true as const } }
            : outcome?.status === "refused" && body.initialMessage
              ? {
                  state: {
                    refusedInitialMessage: {
                      prompt: body.initialMessage,
                      message: outcome.message,
                    },
                  },
                }
              : {}),
        });
      },
    });
    // #1137 adversarial walk: from the request's promise, not onSuccess, so
    // an admitted question is remembered even when the caller pressed Back
    // before it answered; its portal answers it on the next visit. A failure
    // is already the mutation's error.
    request.then(
      (data) => {
        if (data.initialMessage?.status === "pending") {
          rememberPendingFirstTurn(data.portal.id);
        }
      },
      () => {}
    );
  };
  const launch = (stationId: string) => start({ stationId }, "launch");
  const onSubmit = (body: CreatePortalBody) => start(body, "chooser");
  const onStart = (body: StartPortalBody) => start(body, "startBox");
  // A failure from another path mustn't greet the dialog when it opens.
  const onOpen = () => {
    create.reset();
    setChooserOpen(true);
  };
  const onClose = () => {
    create.reset();
    setChooserOpen(false);
  };

  return {
    station,
    pageStation,
    favoriteStations,
    settling,
    gate,
    pending: create.isPending,
    launch,
    chooser: {
      open: chooserOpen,
      onOpen,
      onClose,
      onSubmit,
      // Only a chooser submit's error is the dialog's to show: opening it
      // resets the create, and nothing else submits while it's open.
      serverError: chooserOpen ? toServerError(create.error) : null,
    },
    startBox: {
      onStart,
      serverError: surface === "startBox" ? toServerError(create.error) : null,
    },
  };
}
