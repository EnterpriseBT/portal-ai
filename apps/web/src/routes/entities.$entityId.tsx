import { createFileRoute, Outlet } from "@tanstack/react-router";

export const Route = createFileRoute("/entities/$entityId")({
  component: RouteComponent,
});

function RouteComponent() {
  return <Outlet />;
}
