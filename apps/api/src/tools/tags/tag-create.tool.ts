import { tool } from "ai";

import { EntityTagCreateRequestBodySchema } from "@portalai/core/contracts";

import { Tool } from "../../types/tools.js";
import { ApiCode } from "../../constants/api-codes.constants.js";
import { EntityTagService } from "../../services/entity-tag.service.js";
import type { PermissionContext } from "../../services/permission.service.js";
import { runTagTool } from "./tag-tool.util.js";

const InputSchema = EntityTagCreateRequestBodySchema;

/**
 * #1071: create a tag. The service checks the caller may create tags and
 * refuses a duplicate name; the tag records this session as its provenance
 * (#641).
 */
export class TagCreateTool extends Tool<typeof InputSchema> {
  slug = "tag_create";
  name = "tag_create";
  description =
    "Creates a tag: a name unique in the organization, and optionally a color (hex, e.g. #2563EB) and a description. Create one only when the user asks for a new tag. The user must be allowed to create tags.";

  get schema() {
    return InputSchema;
  }

  build(ctx: PermissionContext, portalId: string | null) {
    return tool({
      description: this.description,
      inputSchema: this.schema,
      execute: (input) =>
        runTagTool(ApiCode.ENTITY_TAG_CREATE_FAILED, async () => {
          const entityTag = await EntityTagService.create(
            ctx,
            this.validate(input),
            { sourcePortalId: portalId }
          );
          return { success: true, entityTag };
        }),
    });
  }
}
