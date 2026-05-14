import { createFileRoute } from "@tanstack/react-router";

import { EditLayoutPlanView } from "../views/EditLayoutPlan.view";

export const Route = createFileRoute(
  "/connectors/$connectorInstanceId/layout-plan/edit"
)({
  component: RouteComponent,
});

function RouteComponent() {
  const { connectorInstanceId } = Route.useParams();
  return <EditLayoutPlanView connectorInstanceId={connectorInstanceId} />;
}
