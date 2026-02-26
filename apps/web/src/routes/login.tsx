import { createFileRoute } from "@tanstack/react-router";
import { PublicLayout } from "../layouts/Public.layout";
import { LoginView } from "../views/Login.view";
import { ApplicationRoute } from "../utils/routes.util";

export const Route = createFileRoute(ApplicationRoute.Login)({
  component: RouteComponent,
});

function RouteComponent() {
  return (
    <PublicLayout>
      <LoginView />
    </PublicLayout>
  );
}
