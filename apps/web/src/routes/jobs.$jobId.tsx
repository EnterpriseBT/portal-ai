import { createFileRoute } from "@tanstack/react-router";

import { Authorized } from "../components/Authorized.component";
import { AuthorizedLayout } from "../layouts/Authorized.layout";
import { JobDetailView } from "../views/JobDetail.view";

export const Route = createFileRoute("/jobs/$jobId")({
  component: RouteComponent,
});

function RouteComponent() {
  const { jobId } = Route.useParams();
  return (
    <Authorized>
      <AuthorizedLayout>
        <JobDetailView jobId={jobId} />
      </AuthorizedLayout>
    </Authorized>
  );
}
