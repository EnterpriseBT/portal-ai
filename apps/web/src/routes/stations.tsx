import { createFileRoute, Outlet } from "@tanstack/react-router";

import { Authorized } from "../components/Authorized.component";
import { AuthorizedLayout } from "../layouts/Authorized.layout";

export const Route = createFileRoute("/stations")({
  component: RouteComponent,
});

function RouteComponent() {
  return (
    <Authorized>
      <AuthorizedLayout>
        <Outlet />
      </AuthorizedLayout>
    </Authorized>
  );
}
