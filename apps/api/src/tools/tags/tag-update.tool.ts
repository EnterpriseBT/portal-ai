import { z } from "zod";
import { tool } from "ai";

import { descriptionField, nameField } from "@portalai/core/contracts";

import { Tool } from "../../types/tools.js";
import { ApiCode } from "../../constants/api-codes.constants.js";
import { EntityTagService } from "../../services/entity-tag.service.js";
import type { PermissionContext } from "../../services/permission.service.js";
import { runTagTool } from "./tag-tool.util.js";

// The route's EntityTagUpdateRequestBodySchema, plus the tag's id.
const InputSchema = z
  .object({
    tagId: z.string().min(1).describe("Id of the tag, from tag_list"),
    name: nameField()
      .optional()
      .describe("A new name, unique in the organization"),
    color: z.string().optional().describe("A new hex color such as #2563EB"),
    description: descriptionField().optional().describe("A new description"),
  })
  .strict()
  .refine(
    ({ name, color, description }) =>
      [name, color, description].some((v) => v !== undefined),
    { message: "At least one field must be provided" }
  );

/**
 * #1071: edit a tag. The service checks the caller may write that tag (an
 * unreadable one is not found) and refuses a rename onto an existing name.
 */
export class TagUpdateTool extends Tool<typeof InputSchema> {
  slug = "tag_update";
  name = "tag_update";
  description =
    "Changes a tag's name, color or description (at least one). The user must be allowed to edit that tag.";

  get schema() {
    return InputSchema;
  }

  build(ctx: PermissionContext) {
    return tool({
      description: this.description,
      inputSchema: this.schema,
      execute: (input) =>
        runTagTool(ApiCode.ENTITY_TAG_UPDATE_FAILED, async () => {
          const { tagId, ...body } = this.validate(input);
          const entityTag = await EntityTagService.update(ctx, tagId, body);
          return { success: true, entityTag };
        }),
    });
  }
}
