import { createFileRoute } from "@tanstack/react-router";

import { ConnectorView } from "../views/Connector.view";
import { guardedComponent } from "../utils/use-require-page-view.util";
import {
  normalizeCreateSearch,
  CONNECTOR_CREATE_KINDS,
} from "../utils/routes.util";

export const Route = createFileRoute("/connectors/")({
  // #1076: `?create=` opens the page's create dialog (the command palette).
  validateSearch: (search: Record<string, unknown>) =>
    normalizeCreateSearch(search, CONNECTOR_CREATE_KINDS),
  // #630: one page id; the Connected/Catalog tabs gate on object read within.
  component: guardedComponent("connectors", ConnectorView),
});
