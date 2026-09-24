import React, { useEffect } from "react";
import { useRouter } from "@tanstack/react-router";

import type { NavPageId } from "@portalai/core/models";

import { useCapabilities } from "./use-capabilities.util";
import { ApplicationRoute } from "./routes.util";

export interface RequirePageViewState {
  /** Render the page body when true. Optimistic: renders while the current-org
   *  query is still loading (avoids a blank on the common allowed path) and once
   *  the caller is confirmed allowed; a confirmed-denied page renders `null`
   *  while the redirect fires. */
  render: boolean;
  /** The caller is confirmed allowed to view the page. */
  allowed: boolean;
  /** The current-org query has resolved. */
  known: boolean;
}

/**
 * Redirect the caller to the Dashboard when they may not `view` the page (#630).
 * A page with sub-tabs backed by different resources (Connectors) passes an
 * array — the caller stays if they may view **any** of them.
 *
 * Runs **in-React** rather than in a TanStack `beforeLoad`: the auth token is
 * only available through the `useAuth` hook (`api.util.ts`), so `beforeLoad`
 * (outside React) cannot fetch the current-org query. This reuses the same
 * cached query the sidebar reads.
 *
 * **Fail policy: optimistic-while-loading, fail-closed once known.** The page
 * renders while the current-org query is unresolved (`!capabilitiesKnown`) — so
 * an *allowed* page never blanks — and, once the map is known, a denied page
 * stops rendering and redirects to the un-gated Dashboard. This is a UX layer,
 * **not** the security boundary: the server enforces on every route/object
 * regardless (an unresolvable query keeps the client on a page whose data the
 * server still returns empty/403). A truly fail-closed variant (blank until
 * known) was rejected because it flashes blank on every allowed navigation.
 */
export function useRequirePageView(
  pageId: NavPageId | readonly NavPageId[]
): RequirePageViewState {
  const ids = Array.isArray(pageId) ? pageId : [pageId as NavPageId];
  const { canViewPage, capabilitiesKnown } = useCapabilities();
  const router = useRouter();
  const allowed = ids.some((id) => canViewPage(id));

  useEffect(() => {
    if (capabilitiesKnown && !allowed) {
      // `to` widened to string — the ApplicationRoute enum defeats TanStack's
      // typed-route inference (CLAUDE.md routing note), same as SidebarNav.
      void router.navigate({
        to: ApplicationRoute.Dashboard as string,
        replace: true,
      });
    }
  }, [capabilitiesKnown, allowed, router]);

  return {
    render: !capabilitiesKnown || allowed,
    allowed,
    known: capabilitiesKnown,
  };
}

/**
 * Wrap a route's view component in the page-view guard (#630). Renders the
 * component when the caller may view the page, otherwise `null` while the
 * redirect fires. Used as a TanStack route `component`:
 * `component: guardedComponent("entities", EntitiesView)`.
 */
export function guardedComponent<P extends object>(
  pageId: NavPageId | readonly NavPageId[],
  Component: React.ComponentType<P>
): React.FC<P> {
  return function GuardedRoute(props: P) {
    const { render } = useRequirePageView(pageId);
    return render ? React.createElement(Component, props) : null;
  };
}
