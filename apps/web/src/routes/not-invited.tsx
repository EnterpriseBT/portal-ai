import { createFileRoute } from "@tanstack/react-router";

import { NotInvitedView } from "../views/NotInvited.view";
import { Authorized } from "../components/Authorized.component";
import { PublicLayout } from "../layouts/Public.layout";

/**
 * Where a caller refused with `SSO_PROVISIONING_NOT_INVITED` lands (#916);
 * the query client's error handler sends them here. `PublicLayout`, not
 * `AuthorizedLayout`, for the same reason as the invitation accept page
 * (#881): the app chrome reads `/memberships` and `/current`, which would
 * re-run provisioning, so the caller would just be refused again.
 */
export const Route = createFileRoute("/not-invited")({
  component: NotInvitedPage,
});

export function NotInvitedPage() {
  return (
    <Authorized>
      <PublicLayout>
        <NotInvitedView />
      </PublicLayout>
    </Authorized>
  );
}
