import { createFileRoute } from "@tanstack/react-router";

import { CuratedViews } from "../views/CuratedViews.view";
import { guardedComponent } from "../utils/use-require-page-view.util";

export const Route = createFileRoute("/views/")({
  component: guardedComponent("views", CuratedViews),
});
