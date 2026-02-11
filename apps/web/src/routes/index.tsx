import { createFileRoute } from "@tanstack/react-router";
import { PublicLayout } from "../layouts/Public.layout";
import { DashboardView } from "../views/Dashboard.view";
import { Authorized } from "../components/Authorized.component";

export const Route = createFileRoute("/")({
  component: DashboardRoute,
});

export function DashboardRoute() {
  return (
    <Authorized>
      <PublicLayout>
        <DashboardView />
      </PublicLayout>
    </Authorized>
  );
}
