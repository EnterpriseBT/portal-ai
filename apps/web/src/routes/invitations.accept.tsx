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
  component: AcceptInvitationRoute,
  validateSearch: (search: Record<string, unknown>) => ({
    token: typeof search.token === "string" ? search.token : undefined,
  }),
});

function AcceptInvitationRoute() {
  const { token } = Route.useSearch();
  return <AcceptInvitationPage token={token} />;
}

export function AcceptInvitationPage({ token }: { token?: string }) {
  return (
    <Authorized>
      <PublicLayout>
        <AcceptInvitationView token={token} />
      </PublicLayout>
    </Authorized>
  );
}
