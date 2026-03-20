import { createFileRoute } from "@tanstack/react-router";

import { EntityRecordDetailView } from "../views/EntityRecordDetail.view";

export const Route = createFileRoute("/entities/$entityId/records/$recordId")({
  component: RouteComponent,
});

function RouteComponent() {
  const { entityId, recordId } = Route.useParams();
  return <EntityRecordDetailView entityId={entityId} recordId={recordId} />;
}
