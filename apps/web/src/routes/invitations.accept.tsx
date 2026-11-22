import { createFileRoute } from "@tanstack/react-router";

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
    token: typeof search.token === "string" ? search.token : undefined,
  }),
});

/**
 * Private, like every route component (#1109): an exported one stays in the
 * main bundle. The token comes from this route's own match, which holds
 * steady until the page unmounts; the router's `location` moves to the next
 * URL as soon as a navigation starts, which would flash the "incomplete
 * link" state after a successful accept.
 */
function AcceptInvitationPage() {
  const { token } = Route.useSearch();
  return (
    <Authorized>
      <PublicLayout>
        <AcceptInvitationView token={token} />
      </PublicLayout>
    </Authorized>
  );
}
