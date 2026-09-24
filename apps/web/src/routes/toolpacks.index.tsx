import { createFileRoute } from "@tanstack/react-router";

import { Toolpacks } from "../views/Toolpacks.view";
import { guardedComponent } from "../utils/use-require-page-view.util";

export const Route = createFileRoute("/toolpacks/")({
  component: guardedComponent("toolpacks", Toolpacks, {
    requireRead: "toolpack",
  }),
});
