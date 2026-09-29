import { createFileRoute } from "@tanstack/react-router";

import { CuratedViewDetail } from "../views/CuratedViewDetail.view";
import { guardedComponent } from "../utils/use-require-page-view.util";

export const Route = createFileRoute("/views/$viewId")({
  component: guardedComponent("views", CuratedViewDetail),
});
