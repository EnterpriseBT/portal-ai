import { createFileRoute } from "@tanstack/react-router";

import { CuratedViews } from "../views/CuratedViews.view";
import { guardedComponent } from "../utils/use-require-page-view.util";
import { normalizeCreateSearch } from "../utils/routes.util";

export const Route = createFileRoute("/views/")({
  // #1076: `?create=` opens the page's create dialog (the command palette).
  validateSearch: (search: Record<string, unknown>) =>
    normalizeCreateSearch(search, ["view"] as const),
  component: guardedComponent("views", CuratedViews),
});
