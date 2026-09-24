import { createFileRoute } from "@tanstack/react-router";

import { ColumnDefinitionListView } from "../views/ColumnDefinitionList.view";
import { guardedComponent } from "../utils/use-require-page-view.util";

export const Route = createFileRoute("/column-definitions/")({
  component: guardedComponent("column_definitions", ColumnDefinitionListView),
});
