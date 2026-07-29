import { createFileRoute } from "@tanstack/react-router";
import { SettingsView } from "../views/Settings.view";
import { Authorized } from "../components/Authorized.component";
import { AuthorizedLayout } from "../layouts/Authorized.layout";
import { ApplicationRoute, SettingsTab } from "../utils/routes.util";

export const Route = createFileRoute(ApplicationRoute.Settings)({
  component: SettingsRoute,
  /**
   * `?tab=` makes the billing tab linkable from the entitlement
   * affordances elsewhere in the app (#284). Unrecognized values are
   * dropped rather than rejected — a bad link should open Settings, not
   * error. The separate `?billing=success|cancelled` checkout return
   * (#176) is read straight off `window.location` in the view and is not
   * declared here.
   */
  validateSearch: (search: Record<string, unknown>) => ({
    tab: Object.values(SettingsTab).includes(search.tab as SettingsTab)
      ? (search.tab as SettingsTab)
      : undefined,
  }),
});

export function SettingsRoute() {
  return (
    <Authorized>
      <AuthorizedLayout>
        <SettingsView />
      </AuthorizedLayout>
    </Authorized>
  );
}
