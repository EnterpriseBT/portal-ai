import { z } from "zod";
import { tool } from "ai";

import { Tool } from "../../types/tools.js";
import { ApiCode } from "../../constants/api-codes.constants.js";
import { CuratedViewService } from "../../services/curated-view.service.js";
import { GrantService } from "../../services/grant.service.js";
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

/**
 * #645: one curated view as the caller may see it (#680: the filter only with
 * write on it), its projected columns by key, and, for a caller who can share
 * it, who it's shared with.
 */
export class CuratedViewGetTool extends Tool<typeof InputSchema> {
  slug = "curated_view_get";
  name = "curated_view_get";
  description =
    "Reads one curated view: its key, label, description, entity, projected columns (each with its key; none means all columns), its row filter (only when the user can edit the view), what the user may do to it, and, when the user can share it, who it is shared with.";

  get schema() {
    return InputSchema;
  }

  build(ctx: PermissionContext) {
    return tool({
      description: this.description,
      inputSchema: this.schema,
      execute: (input) =>
        runViewTool(ApiCode.CURATED_VIEW_FETCH_FAILED, async () => {
          const { curatedViewId } = this.validate(input);
          const curatedView = await CuratedViewService.get(ctx, curatedViewId);
          if (!curatedView.capabilities.share) return { curatedView };
          return {
            curatedView,
            grants: await GrantService.list(ctx, "curated_view", curatedViewId),
          };
        }),
    });
  }
}
