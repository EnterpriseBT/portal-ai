import { createFileRoute } from "@tanstack/react-router";
import { Authorized } from "../components/Authorized.component";
import { AuthorizedLayout } from "../layouts/Authorized.layout";
import { ApplicationRoute } from "../utils/routes.util";
import { ConnectorView } from "../views/ConnectorView";

export const Route = createFileRoute(ApplicationRoute.Connectors)({
  component: RouteComponent,
});

function RouteComponent() {
  return (
    <Authorized>
      <AuthorizedLayout>
        <ConnectorView />
      </AuthorizedLayout>
    </Authorized>
  );
}
