import { createFileRoute } from "@tanstack/react-router";

import { EntityDetailView } from "../views/EntityDetail.view";

export const Route = createFileRoute("/entities/$entityId/")({
  component: RouteComponent,
});

function RouteComponent() {
  const { entityId } = Route.useParams();
  return <EntityDetailView entityId={entityId} />;
}
