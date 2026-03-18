import { createFileRoute } from "@tanstack/react-router";

import { ColumnDefinitionListView } from "../views/ColumnDefinitionList.view";

export const Route = createFileRoute("/column-definitions/")({
  component: ColumnDefinitionListView,
});
