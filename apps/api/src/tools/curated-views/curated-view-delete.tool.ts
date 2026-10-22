import { z } from "zod";
import { tool } from "ai";

import { Tool } from "../../types/tools.js";
import { ApiCode } from "../../constants/api-codes.constants.js";
import { CuratedViewService } from "../../services/curated-view.service.js";
import type { PermissionContext } from "../../services/permission.service.js";
import { runViewTool } from "./curated-view-tool.util.js";

const InputSchema = z
  .object({
    curatedViewId: z
      .string()
      .min(1)
      .describe("Id of the curated view, from curated_view_list"),
  })
  .strict();

/** #645: delete a curated view with the #802 cascade. */
export class CuratedViewDeleteTool extends Tool<typeof InputSchema> {
  slug = "curated_view_delete";
  name = "curated_view_delete";
  description =
    "Deletes a curated view. It is detached from every station and its shares are removed; the result counts what was removed. The user must be allowed to delete the view.";

  get schema() {
    return InputSchema;
  }

  build(ctx: PermissionContext) {
    return tool({
      description: this.description,
      inputSchema: this.schema,
      execute: (input) =>
        runViewTool(ApiCode.CURATED_VIEW_DELETE_FAILED, async () => {
          const { curatedViewId } = this.validate(input);
          return {
            success: true,
            ...(await CuratedViewService.delete(ctx, curatedViewId)),
          };
        }),
    });
  }
}
