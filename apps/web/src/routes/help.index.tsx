import { createFileRoute } from "@tanstack/react-router";

import { HelpView } from "../views/Help.view";

export const Route = createFileRoute("/help/")({
  component: HelpView,
});
