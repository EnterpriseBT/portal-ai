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
 * #1071: add tags to objects of any taggable type, all or nothing:
 * TagAssignmentService.assignMany checks every object and tag with the
 * routes' own rules, then writes every pair in one transaction, so a refusal
 * or a failure applies nothing. A pair the object already carries reports
 * `already_assigned`, never an error.
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
          const pairs = await TagAssignmentService.assignMany(
            ctx,
            targets,
            tagIds
          );
          const results = pairs.map(({ target, entityTagId, created }) => ({
            type: target.type,
            id: target.id,
            tagId: entityTagId,
            status: created ? "assigned" : "already_assigned",
          }));
          return { success: true, results };
        }),
    });
  }
}
