import { createFileRoute } from "@tanstack/react-router";

import { TagsView } from "../views/Tags.view";
import { guardedComponent } from "../utils/use-require-page-view.util";
import { normalizeCreateSearch, TAG_CREATE_KINDS } from "../utils/routes.util";

export const Route = createFileRoute("/tags/")({
  // #1076: `?create=` opens the page's create dialog (the command palette).
  validateSearch: (search: Record<string, unknown>) =>
    normalizeCreateSearch(search, TAG_CREATE_KINDS),
  component: guardedComponent("tags", TagsView, { requireRead: "tag" }),
});
