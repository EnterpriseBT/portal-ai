import { createFileRoute } from "@tanstack/react-router";

import { AcceptInvitationView } from "../views/AcceptInvitation.view";
import { Authorized } from "../components/Authorized.component";
import { AuthorizedLayout } from "../layouts/Authorized.layout";
import { ApplicationRoute } from "../utils/routes.util";

/**
 * Invitee-facing accept landing (#585). `<Authorized>`-wrapped, so a logged-out
 * invitee is sent to login first and returned here afterwards (Auth0
 * `appState.returnTo`). The token travels in the query string only to reach the
 * app; the view posts it in the request body (never logged in the URL).
 */
export const Route = createFileRoute(ApplicationRoute.AcceptInvitation)({
  component: AcceptInvitationRoute,
  validateSearch: (search: Record<string, unknown>) => ({
    token: typeof search.token === "string" ? search.token : undefined,
  }),
});

function AcceptInvitationRoute() {
  const { token } = Route.useSearch();
  return (
    <Authorized>
      <AuthorizedLayout>
        <AcceptInvitationView token={token} />
      </AuthorizedLayout>
    </Authorized>
  );
}
