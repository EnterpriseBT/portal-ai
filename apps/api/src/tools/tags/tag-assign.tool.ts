import { tool } from "ai";

import { Tool } from "../../types/tools.js";
import { ApiCode } from "../../constants/api-codes.constants.js";
import { TagAssignmentService } from "../../services/tag-assignment.service.js";
import type { PermissionContext } from "../../services/permission.service.js";
import { runTagTool } from "./tag-tool.util.js";
import {
  TagAssignmentInputSchema,
  dedupeAssignment,
  preflightAssignment,
} from "./tag-assignment-tool.util.js";

/**
 * #1071: add tags to objects of any taggable type. Every object and tag is
 * checked first, so a refusal applies nothing; then each pair is assigned
 * through TagAssignmentService, the routes' own path. A pair the object
 * already carries reports `already_assigned`, never an error.
 */
export class TagAssignTool extends Tool<typeof TagAssignmentInputSchema> {
  slug = "tag_assign";
  name = "tag_assign";
  description =
    "Adds tags to objects: tagIds (from tag_list) and targets, each { type, id } with type entity, station, pin, connector_instance or curated_view. Objects of different types can go in one call (up to 10 tags and 50 objects). Every object and tag is checked first; if the user can't edit any one object, nothing is applied. Each pair reports assigned or already_assigned.";

  get schema() {
    return TagAssignmentInputSchema;
  }

  build(ctx: PermissionContext) {
    return tool({
      description: this.description,
      inputSchema: this.schema,
      execute: (input) =>
        runTagTool(ApiCode.ENTITY_TAG_ASSIGNMENT_CREATE_FAILED, async () => {
          const { tagIds, targets } = dedupeAssignment(this.validate(input));
          await preflightAssignment(ctx, tagIds, targets);
          const results = [];
          for (const target of targets) {
            for (const tagId of tagIds) {
              const { created } = await TagAssignmentService.assign(
                ctx,
                target,
                tagId
              );
              results.push({
                type: target.type,
                id: target.id,
                tagId,
                status: created ? "assigned" : "already_assigned",
              });
            }
          }
          return { success: true, results };
        }),
    });
  }
}
