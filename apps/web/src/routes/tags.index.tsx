import { createFileRoute } from "@tanstack/react-router";

import { TagsView } from "../views/Tags.view";
import { guardedComponent } from "../utils/use-require-page-view.util";

export const Route = createFileRoute("/tags/")({
  component: guardedComponent("tags", TagsView, { requireRead: "tag" }),
});
