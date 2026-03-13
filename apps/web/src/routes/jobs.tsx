import { createFileRoute } from "@tanstack/react-router";

import { Authorized } from "../components/Authorized.component";
import { AuthorizedLayout } from "../layouts/Authorized.layout";
import { ApplicationRoute } from "../utils/routes.util";
import { JobsView } from "../views/Jobs.view";

export const Route = createFileRoute(ApplicationRoute.Jobs)({
  component: RouteComponent,
});

function RouteComponent() {
  return (
    <Authorized>
      <AuthorizedLayout>
        <JobsView />
      </AuthorizedLayout>
    </Authorized>
  );
}
