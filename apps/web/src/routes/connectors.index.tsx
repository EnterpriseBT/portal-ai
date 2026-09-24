import { createFileRoute } from "@tanstack/react-router";

import { ConnectorView } from "../views/Connector.view";
import { guardedComponent } from "../utils/use-require-page-view.util";

export const Route = createFileRoute("/connectors/")({
  // #630: viewable if the caller may see either sub-tab (instances or catalog).
  component: guardedComponent(
    ["connectors", "connector_catalog"],
    ConnectorView
  ),
});
