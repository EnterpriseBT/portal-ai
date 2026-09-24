import React from "react";

import type { NavPageId, ResourcePermissionType } from "@portalai/core/models";

import { useCapabilities } from "./use-capabilities.util";
import { ForbiddenView } from "../views/Forbidden.view";
import { UnauthorizedState } from "../components/UnauthorizedState.component";

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
 * the common allowed path — the server enforces regardless). Once known:
 *  - a caller who may not `view` the page gets the **`ForbiddenView`** (the nav
 *    item is already hidden);
 *  - for a **single-list page**, an optional `requireRead` object type gates the
 *    page's data — a caller who may view the page but lacks that object `read`
 *    gets an inline **`UnauthorizedState`** (page-view and object-read are
 *    independent levers; they usually align but a custom policy can split them).
 *    Multi-tab pages (Connectors) omit `requireRead` and gate each tab's data
 *    themselves.
 */
export function guardedComponent<P extends object>(
  pageId: NavPageId,
  Component: React.ComponentType<P>,
  opts?: { requireRead?: ResourcePermissionType }
): React.FC<P> {
  return function GuardedRoute(props: P) {
    const { allowed, known } = useRequirePageView(pageId);
    const { canOnResource, capabilitiesKnown } = useCapabilities();
    if (known && !allowed) return React.createElement(ForbiddenView);
    if (
      opts?.requireRead &&
      capabilitiesKnown &&
      !canOnResource(opts.requireRead, "read")
    ) {
      return React.createElement(UnauthorizedState);
    }
    return React.createElement(Component, props);
  };
}
