import { createFileRoute } from "@tanstack/react-router";

import { StationDetailView } from "../views/StationDetail.view";

export const Route = createFileRoute("/stations/$stationId")({
  component: RouteComponent,
});

function RouteComponent() {
  const { stationId } = Route.useParams();
  return <StationDetailView stationId={stationId} />;
}
