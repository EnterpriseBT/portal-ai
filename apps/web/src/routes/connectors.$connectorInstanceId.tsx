import { createFileRoute, Outlet } from "@tanstack/react-router";

export const Route = createFileRoute("/connectors/$connectorInstanceId")({
  component: RouteComponent,
});

function RouteComponent() {
  return <Outlet />;
}
