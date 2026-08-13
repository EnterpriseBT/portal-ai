import { createFileRoute, Outlet } from "@tanstack/react-router";

import { Authorized } from "../components/Authorized.component";
import { AuthorizedLayout } from "../layouts/Authorized.layout";
import {
  ApplicationRoute,
  normalizeHelpSearch,
  type HelpSearch,
} from "../utils/routes.util";

export const Route = createFileRoute(ApplicationRoute.Help)({
  component: RouteComponent,
  /**
   * `?tab=` + `?category=` make a Help section linkable (#365, epic #364).
   * Declared on the layout route so `/help/` and any future child inherit one
   * contract. The rules live in `normalizeHelpSearch` so the route and the
   * view sanitize identically. Unrecognized or mismatched values are dropped,
   * never rejected — a stale link must open Help, not error.
   *
   * The `#<surface>-entry-<slug>` fragment is not a search param; the view
   * reads it from the location hash.
   */
  validateSearch: (search: Record<string, unknown>): HelpSearch =>
    normalizeHelpSearch(search),
});

function RouteComponent() {
  return (
    <Authorized>
      <AuthorizedLayout>
        <Outlet />
      </AuthorizedLayout>
    </Authorized>
  );
}
