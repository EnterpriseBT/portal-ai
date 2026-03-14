import {
  Renderer as JsonRenderer,
  type Spec,
  StateProvider,
  VisibilityProvider,
  ActionProvider,
} from "@json-render/react";
import { StatusMessage } from "@portalai/core/ui";
import { CatalogName, registry } from "@portalai/registry";
import { ApiError } from "../utils";

export interface RendererProps {
  catalogName: CatalogName;
  spec: Spec | null;
  loading?: boolean;
  error?: ApiError | null;
}

export function Renderer({ catalogName, spec, loading, error }: RendererProps) {
  const entry = registry.get(catalogName);

  if (!entry) {
    return <StatusMessage variant="error" message="Catalog not found" />;
  }

  if (error) {
    return <StatusMessage variant="error" error={error} />;
  }

  return (
    <StateProvider>
      <VisibilityProvider>
        <ActionProvider>
          <JsonRenderer
            spec={spec}
            registry={entry.definition.registry}
            loading={loading}
          />
        </ActionProvider>
      </VisibilityProvider>
    </StateProvider>
  );
}
