import { createFileRoute } from "@tanstack/react-router";

import { ConnectorView } from "../views/ConnectorView";

export const Route = createFileRoute("/connectors/")({
  component: ConnectorView,
});
