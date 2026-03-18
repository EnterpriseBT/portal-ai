import { createFileRoute } from "@tanstack/react-router";

import { ConnectorInstanceView } from "../views/ConnectorInstanceView";

export const Route = createFileRoute("/connectors/$connectorInstanceId")({
  component: RouteComponent,
});

function RouteComponent() {
  const { connectorInstanceId } = Route.useParams();
  return <ConnectorInstanceView connectorInstanceId={connectorInstanceId} />;
}
