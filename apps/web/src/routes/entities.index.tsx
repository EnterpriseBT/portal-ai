import { createFileRoute } from "@tanstack/react-router";

import { EntitiesView } from "../views/Entities.view";
import { guardedComponent } from "../utils/use-require-page-view.util";
import {
  normalizeCreateSearch,
  ENTITY_CREATE_KINDS,
} from "../utils/routes.util";

export const Route = createFileRoute("/entities/")({
  // #1076: `?create=` opens the page's create dialog (the command palette).
  validateSearch: (search: Record<string, unknown>) =>
    normalizeCreateSearch(search, ENTITY_CREATE_KINDS),
  component: guardedComponent("entities", EntitiesView, {
    requireRead: "entity",
  }),
});
