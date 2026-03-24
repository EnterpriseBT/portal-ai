import { createFileRoute } from "@tanstack/react-router";

import { EntityGroupDetailView } from "../views/EntityGroupDetail.view";

export const Route = createFileRoute("/entity-groups/$entityGroupId")({
  component: EntityGroupDetailRoute,
});

function EntityGroupDetailRoute() {
  const { entityGroupId } = Route.useParams();
  return <EntityGroupDetailView entityGroupId={entityGroupId} />;
}
