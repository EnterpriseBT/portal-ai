import { createFileRoute } from "@tanstack/react-router";

import { Toolpacks } from "../views/Toolpacks.view";

export const Route = createFileRoute("/toolpacks/")({
  component: Toolpacks,
});
