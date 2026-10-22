import { z } from "zod";
import { tool } from "ai";

import {
  CuratedViewKeySchema,
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

const KEY_DESCRIPTION =
  "Unique key for the view in the organization; it becomes the view's queryable name";

const fields = {
  connectorEntityId: z
    .string()
    .min(1)
    .describe("Id of the connector entity the view reads"),
  label: nameField("Label").describe("Display name of the view"),
  description: descriptionField().nullable().optional(),
  filter: FilterExpressionSchema.nullable()
    .optional()
    .describe("A structured row filter (a FilterGroup over column keys)"),
  filterSql: filterSqlField()
    .nullable()
    .optional()
    .describe(
      "An advanced SQL row filter over column keys, instead of `filter`. Needs a plan with advanced view filters"
    ),
  columns: z
    .array(z.string().min(1))
    .optional()
    .describe("The column keys the view shows, in order; omit for all columns"),
};

/**
 * The schema the model and the AI SDK see. It carries no refines: the SDK
 * checks input with its own zod copy, and a failed refine there leaves the
 * schema on the issue, so the error can't be printed once the schema holds the
 * recursive FilterExpressionSchema. The refines run in `execute` instead
 * (CheckedSchema), where a refusal is CURATED_VIEW_INVALID_PAYLOAD.
 */
const InputSchema = z
  .object({
    ...fields,
    key: z.string().min(1).max(63).describe(KEY_DESCRIPTION),
  })
  .strict();

const CheckedSchema = z
  .object({ ...fields, key: CuratedViewKeySchema })
  .strict()
  .superRefine(oneFilterMode);

/**
 * #645: create a curated view. The service checks the caller may create views
 * and read the entity; the view records this session as its provenance (#641).
 */
export class CuratedViewCreateTool extends Tool<typeof InputSchema> {
  slug = "curated_view_create";
  name = "curated_view_create";
  description =
    "Creates a curated view over one connector entity: a unique key, a label, optionally the columns it shows (by column key) and a row filter (a structured filter or an advanced SQL filter, not both). It does not attach the view to any station. The user must be allowed to create views and read the entity.";

  get schema() {
    return InputSchema;
  }

  build(ctx: PermissionContext, portalId: string | null) {
    return tool({
      description: this.description,
      inputSchema: this.schema,
      execute: (input) =>
        runViewTool(ApiCode.CURATED_VIEW_CREATE_FAILED, async () => {
          const { columns, ...body } = CheckedSchema.parse(input);
          const curatedView = await CuratedViewService.create(
            ctx,
            { ...body, columnKeys: columns },
            { sourcePortalId: portalId }
          );
          return { success: true, curatedView };
        }),
    });
  }
}
