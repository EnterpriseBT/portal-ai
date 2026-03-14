import { createFileRoute } from "@tanstack/react-router";

import { JobsView } from "../views/Jobs.view";

export const Route = createFileRoute("/jobs/")({
  component: JobsView,
});
