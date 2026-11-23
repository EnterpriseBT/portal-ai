import { z } from "zod";
import { tool } from "ai";

import { Tool } from "../../types/tools.js";
import { ApiCode } from "../../constants/api-codes.constants.js";
import { EntityTagService } from "../../services/entity-tag.service.js";
import type { PermissionContext } from "../../services/permission.service.js";
import { runTagTool } from "./tag-tool.util.js";

const InputSchema = z
  .object({
    tagId: z.string().min(1).describe("Id of the tag, from tag_list"),
  })
  .strict();

/**
 * #1071: delete a tag, taking it off every object. The service checks the
 * caller may delete that tag; `removedFrom` counts only objects the caller
 * can read, so the result reveals nothing they couldn't see.
 */
export class TagDeleteTool extends Tool<typeof InputSchema> {
  slug = "tag_delete";
  name = "tag_delete";
  description =
    "Deletes a tag and removes it from every object that carries it. The result counts, per object type, the objects it came off that the user can read. The user must be allowed to delete that tag.";

  get schema() {
    return InputSchema;
  }

  build(ctx: PermissionContext) {
    return tool({
      description: this.description,
      inputSchema: this.schema,
      execute: (input) =>
        runTagTool(ApiCode.ENTITY_TAG_DELETE_FAILED, async () => {
          const { id, removedFrom } = await EntityTagService.delete(
            ctx,
            this.validate(input).tagId
          );
          return { success: true, id, removedFrom };
        }),
    });
  }
}
