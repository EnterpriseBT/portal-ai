import { createFileRoute } from "@tanstack/react-router";

import { FullScreenLayout } from "../layouts/FullScreen.layout";
import { PortalView } from "../views/Portal.view";
import { Authorized } from "../components/Authorized.component";

export const Route = createFileRoute("/portals/$portalId")({
  component: RouteComponent,
});

function RouteComponent() {
  const { portalId } = Route.useParams();
  return (
    <Authorized>
      <FullScreenLayout>
        <PortalView portalId={portalId} />
      </FullScreenLayout>
    </Authorized>
  );
}
