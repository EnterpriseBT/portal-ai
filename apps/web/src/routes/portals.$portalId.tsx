import { createFileRoute } from "@tanstack/react-router";

import { PortalSession } from "../components/PortalSession.component";

export const Route = createFileRoute("/portals/$portalId")({
  component: RouteComponent,
});

function RouteComponent() {
  const { portalId } = Route.useParams();
  return <PortalSession portalId={portalId} />;
}
