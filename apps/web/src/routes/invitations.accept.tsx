import { createFileRoute, useRouterState } from "@tanstack/react-router";

import { AcceptInvitationView } from "../views/AcceptInvitation.view";
import { Authorized } from "../components/Authorized.component";
import { PublicLayout } from "../layouts/Public.layout";

/**
 * Invitee-facing accept landing (#585). `<Authorized>`-wrapped, so a logged-out
 * invitee is sent to login first and returned here afterwards (Auth0
 * `appState.returnTo`). The token travels in the query string only to reach the
 * app; the view posts it in the request body (never logged in the URL).
 *
 * #881: `PublicLayout`, not `AuthorizedLayout`. The app chrome's org switcher
 * and nav read `/memberships` and `/current`, which self-provision a caller
 * with no live membership, so an invitee without one would get a stray
 * personal org before the accept POST binds the invited one. Nothing here
 * reads the caller's org until the accept has run.
 */
export const Route = createFileRoute("/invitations/accept")({
  component: AcceptInvitationPage,
  validateSearch: (search: Record<string, unknown>) => ({
    token: tokenFrom(search),
  }),
});

function tokenFrom(search: Record<string, unknown>): string | undefined {
  return typeof search.token === "string" ? search.token : undefined;
}

/**
 * Private, like every route component (#1109): an exported one stays in the
 * main bundle. It reads the token from the location rather than the route
 * match (`Route.useSearch()`), so a test can render `Route.options.component`
 * without registering the route.
 */
function AcceptInvitationPage() {
  const token = useRouterState({
    select: (s) => tokenFrom(s.location.search as Record<string, unknown>),
  });
  return (
    <Authorized>
      <PublicLayout>
        <AcceptInvitationView token={token} />
      </PublicLayout>
    </Authorized>
  );
}
