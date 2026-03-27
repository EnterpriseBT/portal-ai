import { createFileRoute } from "@tanstack/react-router";

import { PinnedResultDetailView } from "../views/PinnedResultDetail.view";

export const Route = createFileRoute("/portal-results/$portalResultId")({
  component: RouteComponent,
});

function RouteComponent() {
  const { portalResultId } = Route.useParams();
  return <PinnedResultDetailView portalResultId={portalResultId} />;
}
