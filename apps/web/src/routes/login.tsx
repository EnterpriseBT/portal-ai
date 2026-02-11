import { createFileRoute } from "@tanstack/react-router";
import { PublicLayout } from "../layouts/Public.layout";
import { LoginView } from "../views/Login.view";

export const Route = createFileRoute("/login")({
  component: RouteComponent,
});

function RouteComponent() {
  return (
    <PublicLayout>
      <LoginView />
    </PublicLayout>
  );
}
