import { createFileRoute } from "@tanstack/react-router";

import { StationsView } from "../views/Stations.view";
import { guardedComponent } from "../utils/use-require-page-view.util";

export const Route = createFileRoute("/stations/")({
  component: guardedComponent("stations", StationsView, {
    requireRead: "station",
  }),
});
