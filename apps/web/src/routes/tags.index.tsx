import { createFileRoute } from "@tanstack/react-router";

import { TagsView } from "../views/Tags.view";

export const Route = createFileRoute("/tags/")({
  component: TagsView,
});
