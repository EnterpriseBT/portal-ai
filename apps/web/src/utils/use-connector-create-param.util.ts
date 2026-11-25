import { useRouterState } from "@tanstack/react-router";

import type { ConnectorDefinition } from "@portalai/core/models";

import { sdk } from "../api/sdk";
import { useCreateGate } from "./use-create-gate.util";
import { useCreateParam } from "./use-create-param.util";

/**
 * #1076: the connectors page's `?create=<workflow slug>` (the command
 * palette's Import a file). The catalog is read only while such a link is
 * pending, to find the active definition with that slug; an unknown slug, an
 * inactive definition or one with no workflow opens nothing.
 */
export function useConnectorCreateParam({
  canReadCatalog,
  capabilitiesKnown,
  hasWorkflow,
  onConnect,
}: {
  canReadCatalog: boolean;
  capabilitiesKnown: boolean;
  hasWorkflow: (slug: string) => boolean;
  onConnect: (definition: ConnectorDefinition) => void;
}): void {
  const createParam = useRouterState({
    select: (s) => (s.location.search as Record<string, unknown>).create,
  });
  const catalog = sdk.connectorDefinitions.list(
    {
      limit: 100,
      offset: 0,
      sortBy: "display",
      sortOrder: "asc",
      isActive: true,
    },
    { enabled: typeof createParam === "string" && canReadCatalog }
  );
  const gate = useCreateGate(
    "connector_instance",
    "Ask for access to connect data"
  );
  useCreateParam({
    gate,
    ready:
      capabilitiesKnown &&
      (!canReadCatalog || catalog.isSuccess || catalog.isError),
    onOpen: (slug) => {
      const definition = catalog.data?.connectorDefinitions.find(
        (cd) => cd.slug === slug && cd.isActive && hasWorkflow(cd.slug)
      );
      if (definition) onConnect(definition);
    },
  });
}
