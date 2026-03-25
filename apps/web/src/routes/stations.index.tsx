import { createFileRoute } from "@tanstack/react-router";

import { StationsView } from "../views/Stations.view";

export const Route = createFileRoute("/stations/")({
  component: StationsView,
});
