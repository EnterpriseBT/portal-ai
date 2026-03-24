import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/entity-groups/$entityGroupId")({
  component: EntityGroupDetailPlaceholder,
});

function EntityGroupDetailPlaceholder() {
  const { entityGroupId } = Route.useParams();
  return <div>Entity Group Detail: {entityGroupId}</div>;
}
