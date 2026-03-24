import { createFileRoute } from "@tanstack/react-router";

import { EntityGroupsView } from "../views/EntityGroups.view";

export const Route = createFileRoute("/entity-groups/")({
  component: EntityGroupsView,
});
