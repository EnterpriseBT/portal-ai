import { createFileRoute } from "@tanstack/react-router";

import { EntitiesView } from "../views/Entities.view";
import { guardedComponent } from "../utils/use-require-page-view.util";

export const Route = createFileRoute("/entities/")({
  component: guardedComponent("entities", EntitiesView),
});
