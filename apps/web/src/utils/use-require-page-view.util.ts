import React from "react";

import type { NavPageId } from "@portalai/core/models";

import { useCapabilities } from "./use-capabilities.util";
import { ForbiddenView } from "../views/Forbidden.view";

export interface RequirePageViewState {
  /** The caller is confirmed allowed to view the page. */
  allowed: boolean;
  /** The current-org query has resolved (page permissions are known). */
  known: boolean;
}

/**
 * Whether the caller may `view` the page (#630). A page with sub-tabs backed by
 * different resources is gated by **one** id (the tabs gate on object read
 * separately). Reads the same cached current-org query the sidebar reads;
 * fail-closed once known.
 */
export function useRequirePageView(pageId: NavPageId): RequirePageViewState {
  const { canViewPage, capabilitiesKnown } = useCapabilities();
  return { allowed: canViewPage(pageId), known: capabilitiesKnown };
}

/**
 * Wrap a route's view component in the page-view guard (#630). While the
 * current-org query is loading, the page renders **optimistically** (no blank on
 * the common allowed path — the server enforces regardless). Once known, a caller
 * who may not `view` the page gets the **`ForbiddenView`** in place — the honest
 * surface (the nav item is already hidden). Used as a TanStack route `component`:
 * `component: guardedComponent("entities", EntitiesView)`.
 */
export function guardedComponent<P extends object>(
  pageId: NavPageId,
  Component: React.ComponentType<P>
): React.FC<P> {
  return function GuardedRoute(props: P) {
    const { allowed, known } = useRequirePageView(pageId);
    if (known && !allowed) return React.createElement(ForbiddenView);
    return React.createElement(Component, props);
  };
}
