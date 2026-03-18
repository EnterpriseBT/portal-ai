import { createFileRoute } from "@tanstack/react-router";

import { ConnectorView } from "../views/Connector.view";

export const Route = createFileRoute("/connectors/")({
  component: ConnectorView,
});
