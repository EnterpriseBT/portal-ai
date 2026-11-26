import { createFileRoute } from "@tanstack/react-router";

import { StationsView } from "../views/Stations.view";
import { guardedComponent } from "../utils/use-require-page-view.util";
import {
  normalizeCreateSearch,
  STATION_CREATE_KINDS,
} from "../utils/routes.util";

export const Route = createFileRoute("/stations/")({
  // #1076: `?create=` opens the page's create dialog (the command palette).
  validateSearch: (search: Record<string, unknown>) =>
    normalizeCreateSearch(search, STATION_CREATE_KINDS),
  component: guardedComponent("stations", StationsView, {
    requireRead: "station",
  }),
});
