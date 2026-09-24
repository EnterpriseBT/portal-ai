import { createFileRoute } from "@tanstack/react-router";

import { EntityGroupsView } from "../views/EntityGroups.view";
import { guardedComponent } from "../utils/use-require-page-view.util";

export const Route = createFileRoute("/entity-groups/")({
  component: guardedComponent("entity_groups", EntityGroupsView),
});
