import { createFileRoute } from "@tanstack/react-router";

import { PinnedResultsListView } from "../views/PinnedResultsListView.view";
import { guardedComponent } from "../utils/use-require-page-view.util";

export const Route = createFileRoute("/portal-results/")({
  component: guardedComponent("pinned", PinnedResultsListView),
});
