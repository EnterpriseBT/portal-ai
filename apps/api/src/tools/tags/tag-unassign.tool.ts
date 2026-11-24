import { tool } from "ai";

import { Tool } from "../../types/tools.js";
import { ApiCode } from "../../constants/api-codes.constants.js";
import { TagAssignmentService } from "../../services/tag-assignment.service.js";
import type { PermissionContext } from "../../services/permission.service.js";
import { runTagTool } from "./tag-tool.util.js";
import {
  TagAssignmentInputSchema,
  dedupeAssignment,
} from "./tag-assignment-tool.util.js";

/**
 * #1071: remove tags from objects of any taggable type, all or nothing:
 * TagAssignmentService.unassignMany checks every object and tag with the
 * routes' own rules, then removes every pair in one transaction. A pair the
 * object doesn't carry (including one removed meanwhile) reports
 * `not_assigned`, never an error.
 */
export class TagUnassignTool extends Tool<typeof TagAssignmentInputSchema> {
  slug = "tag_unassign";
  name = "tag_unassign";
  description =
    "Removes tags from objects: tagIds (from tag_list) and targets, each { type, id } with type entity, station, pin, connector_instance or curated_view. Objects of different types can go in one call (up to 10 tags and 50 objects). Every object and tag is checked first; if the user can't edit any one object, nothing is removed. Each pair reports removed or not_assigned.";

  get schema() {
    return TagAssignmentInputSchema;
  }

  build(ctx: PermissionContext) {
    return tool({
      description: this.description,
      inputSchema: this.schema,
      execute: (input) =>
        runTagTool(ApiCode.ENTITY_TAG_ASSIGNMENT_DELETE_FAILED, async () => {
          const { tagIds, targets } = dedupeAssignment(this.validate(input));
          const pairs = await TagAssignmentService.unassignMany(
            ctx,
            targets,
            tagIds
          );
          const results = pairs.map(({ target, entityTagId, removed }) => ({
            type: target.type,
            id: target.id,
            tagId: entityTagId,
            status: removed ? "removed" : "not_assigned",
          }));
          return { success: true, results };
        }),
    });
  }
}
