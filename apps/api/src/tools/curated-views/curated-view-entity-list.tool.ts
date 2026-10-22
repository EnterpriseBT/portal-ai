import { z } from "zod";
import { tool } from "ai";

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
      .describe("Match entities whose key or label contains this text"),
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

/**
 * #645: the entities a view can be built on. A session only sees the entities
 * behind its station's attached views (#599), so without this the agent had
 * no id or column keys for a view over any other entity.
 */
export class CuratedViewEntityListTool extends Tool<typeof InputSchema> {
  slug = "curated_view_entity_list";
  name = "curated_view_entity_list";
  description =
    "Lists the connector entities the user can read, sorted by label, each with its id, key, label, connector, and its columns (key, label, type). Use this to find the `connectorEntityId` and column keys for curated_view_create, including entities this station has no view on yet. It lists entities only; to query their data, a view on them must be attached to the station.";

  get schema() {
    return InputSchema;
  }

  build(ctx: PermissionContext) {
    return tool({
      description: this.description,
      inputSchema: this.schema,
      execute: (input) =>
        runViewTool(ApiCode.CURATED_VIEW_FETCH_FAILED, async () => {
          const { search, limit, offset } = this.validate(input);
          return CuratedViewService.listEntities(ctx, {
            search,
            limit: limit ?? 25,
            offset: offset ?? 0,
          });
        }),
    });
  }
}
