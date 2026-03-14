import { createFileRoute } from "@tanstack/react-router";

import { JobDetailView } from "../views/JobDetail.view";

export const Route = createFileRoute("/jobs/$jobId")({
  component: RouteComponent,
});

function RouteComponent() {
  const { jobId } = Route.useParams();
  return <JobDetailView jobId={jobId} />;
}
