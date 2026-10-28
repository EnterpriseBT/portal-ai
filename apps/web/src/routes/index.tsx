import { createFileRoute } from "@tanstack/react-router";
import { DashboardView } from "../views/Dashboard.view";
import { Authorized } from "../components/Authorized.component";
import { AuthorizedLayout } from "../layouts/Authorized.layout";

export const Route = createFileRoute("/")({
  component: DashboardRoute,
});

export function DashboardRoute() {
  return (
    <Authorized>
      <AuthorizedLayout>
        <DashboardView />
      </AuthorizedLayout>
    </Authorized>
  );
}
