import { createFileRoute } from "@tanstack/react-router";

import { ConnectorView } from "../views/Connector.view";
import { guardedComponent } from "../utils/use-require-page-view.util";

export const Route = createFileRoute("/connectors/")({
  // #630: one page id; the Connected/Catalog tabs gate on object read within.
  component: guardedComponent("connectors", ConnectorView),
});
