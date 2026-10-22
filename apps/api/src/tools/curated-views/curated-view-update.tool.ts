import { z } from "zod";
import { tool } from "ai";

import {
  FilterExpressionSchema,
  descriptionField,
  filterSqlField,
  nameField,
  oneFilterMode,
} from "@portalai/core/contracts";

import { Tool } from "../../types/tools.js";
import { ApiCode } from "../../constants/api-codes.constants.js";
import { CuratedViewService } from "../../services/curated-view.service.js";
import type { PermissionContext } from "../../services/permission.service.js";
import { runViewTool } from "./curated-view-tool.util.js";

const fields = {
  curatedViewId: z
    .string()
    .min(1)
    .describe("Id of the curated view, from curated_view_list"),
  label: nameField("Label").optional(),
  description: descriptionField().nullable().optional(),
  filter: FilterExpressionSchema.nullable()
    .optional()
    .describe(
      "A structured row filter; setting it clears any SQL filter, null removes it"
    ),
  filterSql: filterSqlField()
    .nullable()
    .optional()
    .describe(
      "An advanced SQL row filter; setting it clears any structured filter, null removes it"
    ),
  columns: z
    .array(z.string().min(1))
    .optional()
    .describe(
      "The full set of column keys the view shows, replacing the current set; [] for all columns"
    ),
};

/**
 * The schema the model and the AI SDK see, without refines; see the create
 * tool for why. The refines run in `execute` (CheckedSchema).
 */
const InputSchema = z.object(fields).strict();

const CheckedSchema = InputSchema.superRefine(oneFilterMode).refine(
  ({ curatedViewId: _id, ...changes }) =>
    Object.values(changes).some((v) => v !== undefined),
  { message: "Give at least one field to change" }
);

/** #645: edit a curated view's label, description, row filter or columns. */
export class CuratedViewUpdateTool extends Tool<typeof InputSchema> {
  slug = "curated_view_update";
  name = "curated_view_update";
  description =
    "Edits a curated view: its label, description, row filter (structured or SQL; setting one clears the other) or the full set of columns it shows (by column key). The view's key and entity can't change. The user must be allowed to edit the view, and to read its entity to change its columns or filter.";

  get schema() {
    return InputSchema;
  }

  build(ctx: PermissionContext) {
    return tool({
      description: this.description,
      inputSchema: this.schema,
      execute: (input) =>
        runViewTool(ApiCode.CURATED_VIEW_UPDATE_FAILED, async () => {
          const { curatedViewId, columns, ...body } =
            CheckedSchema.parse(input);
          const curatedView = await CuratedViewService.update(
            ctx,
            curatedViewId,
            { ...body, columnKeys: columns }
          );
          return { success: true, curatedView };
        }),
    });
  }
}
