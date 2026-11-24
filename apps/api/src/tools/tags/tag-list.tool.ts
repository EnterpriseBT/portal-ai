import { z } from "zod";
import { tool } from "ai";

import { Tool } from "../../types/tools.js";
import { ApiCode } from "../../constants/api-codes.constants.js";
import { EntityTagService } from "../../services/entity-tag.service.js";
import { TagAssignmentService } from "../../services/tag-assignment.service.js";
import type { PermissionContext } from "../../services/permission.service.js";
import { runTagTool, TagTargetInputSchema } from "./tag-tool.util.js";

const InputSchema = z
  .object({
    search: z
      .string()
      .optional()
      .describe("Match tags whose name or description contains this text"),
    target: TagTargetInputSchema.optional().describe(
      "List the tags on this object instead of the catalog"
    ),
    limit: z.number().int().min(1).max(100).default(25),
    offset: z.number().int().min(0).default(0),
  })
  .strict();

/** What the agent needs of a tag: enough to pick it and to describe it. */
const brief = (tag: {
  id: string;
  name: string;
  color: string | null;
  description: string | null;
  sourcePortalId?: string | null;
}) => ({
  id: tag.id,
  name: tag.name,
  color: tag.color,
  description: tag.description,
  sourcePortalId: tag.sourcePortalId ?? null,
});

/**
 * #1071: list the tags the user can read, or the tags on one object. The
 * services apply the routes' read rules: only readable tags, and a target
 * the user can't read is not found.
 */
export class TagListTool extends Tool<typeof InputSchema> {
  slug = "tag_list";
  name = "tag_list";
  description =
    "Lists the tags the user can read, sorted by name, each with its id, name, color and description. With a target ({ type, id }, where type is entity, station, pin, connector_instance or curated_view), lists the tags on that one object instead, each with its assignmentId. Use this to find a tag's id before adding, removing, editing or deleting it.";

  get schema() {
    return InputSchema;
  }

  build(ctx: PermissionContext) {
    return tool({
      description: this.description,
      inputSchema: this.schema,
      execute: (input) =>
        runTagTool(ApiCode.ENTITY_TAG_FETCH_FAILED, async () => {
          const { search, target, limit, offset } = this.validate(input);
          if (target) {
            const tags = await TagAssignmentService.list(ctx, target);
            return {
              tags: tags.map((tag) => ({
                ...brief(tag),
                assignmentId: tag.assignmentId,
              })),
            };
          }
          const { entityTags, total } = await EntityTagService.list(ctx, {
            search,
            limit,
            offset,
            sortBy: "name",
            sortOrder: "asc",
          });
          return { tags: entityTags.map(brief), total };
        }),
    });
  }
}
