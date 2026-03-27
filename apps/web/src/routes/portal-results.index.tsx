import { createFileRoute } from "@tanstack/react-router";

import { PinnedResultsListView } from "../views/PinnedResultsListView.view";

export const Route = createFileRoute("/portal-results/")({
  component: PinnedResultsListView,
});
