import { createFileRoute } from "@tanstack/react-router";
import { SettingsView } from "../views/Settings.view";
import { Authorized } from "../components/Authorized.component";
import { AuthorizedLayout } from "../layouts/Authorized.layout";

export const Route = createFileRoute("/settings")({
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
