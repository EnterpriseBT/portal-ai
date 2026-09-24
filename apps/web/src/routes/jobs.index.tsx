import { createFileRoute } from "@tanstack/react-router";

import { JobsView } from "../views/Jobs.view";
import { guardedComponent } from "../utils/use-require-page-view.util";

export const Route = createFileRoute("/jobs/")({
  component: guardedComponent("jobs", JobsView),
});
