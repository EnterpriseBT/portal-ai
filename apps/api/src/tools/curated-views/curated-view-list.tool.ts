import { z } from "zod";
import { tool } from "ai";

import { CuratedViewListRequestQuerySchema } from "@portalai/core/contracts";

import { Tool } from "../../types/tools.js";
import { ApiCode } from "../../constants/api-codes.constants.js";
import { CuratedViewService } from "../../services/curated-view.service.js";
import type { PermissionContext } from "../../services/permission.service.js";
import { runViewTool } from "./curated-view-tool.util.js";

const InputSchema = z
  .object({
    search: z
      .string()
      .optional()
      .describe("Match views whose label contains this text"),
    connectorEntityId: z
      .string()
      .optional()
      .describe("Only views over this connector entity"),
    limit: z
      .number()
      .int()
      .min(1)
      .max(100)
      .optional()
      .describe("Page size, 1-100 (default 25)"),
    offset: z
      .number()
      .int()
      .min(0)
      .optional()
      .describe("Rows to skip (default 0)"),
  })
  .strict();

/** #645: the curated views the caller may read, by label. */
export class CuratedViewListTool extends Tool<typeof InputSchema> {
  slug = "curated_view_list";
  name = "curated_view_list";
  description =
    "Lists the curated views the user can read, sorted by label, each with its id, key, label, entity, whether it filters rows or selects columns, and what the user may do to it (capabilities). Use this to find a view's id before reading, editing, deleting or sharing it.";

  get schema() {
    return InputSchema;
  }

  build(ctx: PermissionContext) {
    return tool({
      description: this.description,
      inputSchema: this.schema,
      execute: (input) =>
        runViewTool(ApiCode.CURATED_VIEW_FETCH_FAILED, async () => {
          const { search, connectorEntityId, limit, offset } =
            this.validate(input);
          return CuratedViewService.list(
            ctx,
            CuratedViewListRequestQuerySchema.parse({
              search,
              connectorEntityId,
              limit: limit ?? 25,
              offset: offset ?? 0,
              sortBy: "label",
              sortOrder: "asc",
            })
          );
        }),
    });
  }
}
