import { createFileRoute } from "@tanstack/react-router";

import { ColumnDefinitionDetailView } from "../views/ColumnDefinitionDetail.view";

export const Route = createFileRoute("/column-definitions/$columnDefinitionId")(
  {
    component: RouteComponent,
  }
);

function RouteComponent() {
  const { columnDefinitionId } = Route.useParams();
  return <ColumnDefinitionDetailView columnDefinitionId={columnDefinitionId} />;
}
