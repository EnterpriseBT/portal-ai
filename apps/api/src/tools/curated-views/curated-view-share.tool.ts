import { z } from "zod";
import { tool } from "ai";

import { ShareGranteeSchema } from "@portalai/core/contracts";

import { Tool } from "../../types/tools.js";
import { ApiCode } from "../../constants/api-codes.constants.js";
import { GrantService } from "../../services/grant.service.js";
import type { PermissionContext } from "../../services/permission.service.js";
import { AGENT_AUDIT } from "../rbac/rbac-tool.util.js";
import { runViewTool } from "./curated-view-tool.util.js";

const InputSchema = z
  .object({
    curatedViewId: z
      .string()
      .min(1)
      .describe("Id of the curated view, from curated_view_list"),
    grantee: ShareGranteeSchema.describe(
      'Who to share with: { "type": "user", "userId": … } for one member (find the userId with member_list), or { "type": "team" } for the whole organization'
    ),
    access: z
      .enum(["read", "read-write", "none"])
      .describe(
        "read, read-write (never conveys delete), or none to stop sharing with the grantee"
      ),
  })
  .strict();

/**
 * #645: share a curated view with a member or the team, or stop sharing it
 * (`access: "none"`). Wraps `GrantService`, which requires share on the view
 * and refuses access beyond the caller's own.
 */
export class CuratedViewShareTool extends Tool<typeof InputSchema> {
  slug = "curated_view_share";
  name = "curated_view_share";
  description =
    "Shares a curated view with one member or the whole team at read or read-write access, replacing any share that grantee already had, or stops sharing it with access \"none\". The user must be allowed to share the view, and can't give access they don't have.";

  get schema() {
    return InputSchema;
  }

  build(ctx: PermissionContext) {
    return tool({
      description: this.description,
      inputSchema: this.schema,
      execute: (input) =>
        runViewTool(ApiCode.CURATED_VIEW_SHARE_FAILED, async () => {
          const { curatedViewId, grantee, access } = this.validate(input);
          if (access !== "none") {
            return {
              success: true,
              grant: await GrantService.share(
                ctx,
                {
                  resourceType: "curated_view",
                  resourceId: curatedViewId,
                  grantee,
                  access,
                },
                AGENT_AUDIT
              ),
            };
          }
          const { principalType, principalId } = GrantService.granteePrincipal(
            ctx.organizationId,
            grantee
          );
          const existing = (
            await GrantService.list(ctx, "curated_view", curatedViewId)
          ).find(
            (g) =>
              g.principalType === principalType && g.principalId === principalId
          );
          if (!existing) return { success: true, revoked: false };
          await GrantService.revoke(ctx, existing.id, AGENT_AUDIT);
          return { success: true, revoked: true };
        }),
    });
  }
}
