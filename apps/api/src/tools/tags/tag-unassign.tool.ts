import { tool } from "ai";

import { Tool } from "../../types/tools.js";
import { ApiCode } from "../../constants/api-codes.constants.js";
import { DbService } from "../../services/db.service.js";
import { TagAssignmentService } from "../../services/tag-assignment.service.js";
import type { PermissionContext } from "../../services/permission.service.js";
import { runTagTool } from "./tag-tool.util.js";
import {
  TagAssignmentInputSchema,
  dedupeAssignment,
  preflightAssignment,
} from "./tag-assignment-tool.util.js";

/**
 * #1071: remove tags from objects of any taggable type. Every object and tag
 * is checked first, so a refusal removes nothing; then each pair the object
 * carries is removed through TagAssignmentService, the routes' own path. A
 * pair it doesn't carry reports `not_assigned`, never an error.
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
          await preflightAssignment(ctx, tagIds, targets);
          const results = [];
          for (const target of targets) {
            const assigned = new Map(
              (
                await DbService.repository.entityTagAssignments.findByTarget(
                  target
                )
              ).map((row) => [row.id, row.assignmentId])
            );
            for (const tagId of tagIds) {
              const assignmentId = assigned.get(tagId);
              if (assignmentId) {
                await TagAssignmentService.unassign(ctx, target, assignmentId);
              }
              results.push({
                type: target.type,
                id: target.id,
                tagId,
                status: assignmentId ? "removed" : "not_assigned",
              });
            }
          }
          return { success: true, results };
        }),
    });
  }
}
