import { createFileRoute } from "@tanstack/react-router";
import { SettingsView } from "../views/Settings.view";
import { Authorized } from "../components/Authorized.component";
import { AuthorizedLayout } from "../layouts/Authorized.layout";
import { ApplicationRoute } from "../utils/routes.util";

export const Route = createFileRoute(ApplicationRoute.Settings)({
  component: SettingsRoute,
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
