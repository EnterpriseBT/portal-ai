import { createFileRoute } from "@tanstack/react-router";

import { EntitiesView } from "../views/Entities.view";

export const Route = createFileRoute("/entities/")({
  component: EntitiesView,
});
