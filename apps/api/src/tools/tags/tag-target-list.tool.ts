import { z } from "zod";
import { tool } from "ai";

import { TagTargetTypeSchema } from "@portalai/core/models";

import { Tool } from "../../types/tools.js";
import { ApiCode } from "../../constants/api-codes.constants.js";
import { TagAssignmentService } from "../../services/tag-assignment.service.js";
import type { PermissionContext } from "../../services/permission.service.js";
import { runTagTool } from "./tag-tool.util.js";

const InputSchema = z
  .object({
    type: TagTargetTypeSchema.describe(
      "The object type: entity, station, pin (a pinned result), connector_instance or curated_view"
    ),
    search: z
      .string()
      .optional()
      .describe(
        "Match objects whose name contains this text (for views and entities, the label or key)"
      ),
    limit: z.number().int().min(1).max(100).default(25),
    offset: z.number().int().min(0).default(0),
  })
  .strict();

/**
 * #1071 smoke walk: find the objects of one taggable type the user can read,
 * with their ids, so tag_assign / tag_unassign / tag_list have something to
 * name. Without it the pack could only manage the catalog on a station with
 * no data and no other lookup tools (Administrate).
 */
export class TagTargetListTool extends Tool<typeof InputSchema> {
  slug = "tag_target_list";
  name = "tag_target_list";
  description =
    "Lists objects of one type the user can read, sorted by name, each with its type, id and name: entities, stations, pins (pinned results), connector_instances (connectors) or curated_views. Use it to find an object's id before adding or removing tags on it. search matches the name (for views and entities, the label or key).";

  get schema() {
    return InputSchema;
  }

  build(ctx: PermissionContext) {
    return tool({
      description: this.description,
      inputSchema: this.schema,
      execute: (input) =>
        runTagTool(ApiCode.ENTITY_TAG_FETCH_FAILED, async () => {
          const { type, search, limit, offset } = this.validate(input);
          return TagAssignmentService.listTargets(ctx, type, {
            search,
            limit,
            offset,
          });
        }),
    });
  }
}
