import { createFileRoute } from "@tanstack/react-router";

import { EntitiesView } from "../views/Entities.view";
import { guardedComponent } from "../utils/use-require-page-view.util";
import { normalizeCreateSearch } from "../utils/routes.util";

export const Route = createFileRoute("/entities/")({
  // #1076: `?create=` opens the page's create dialog (the command palette).
  validateSearch: (search: Record<string, unknown>) =>
    normalizeCreateSearch(search, ["entity"] as const),
  component: guardedComponent("entities", EntitiesView, {
    requireRead: "entity",
  }),
});
