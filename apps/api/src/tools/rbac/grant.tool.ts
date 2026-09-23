import { z } from "zod";
import { tool } from "ai";

import {
  ShareGrantRequestSchema,
  ShareResourceTypeSchema,
} from "@portalai/core/contracts";

import { Tool } from "../../types/tools.js";
import { GrantService } from "../../services/grant.service.js";
import type { PermissionContext } from "../../services/permission.service.js";
import { AGENT_AUDIT, runRbac } from "./rbac-tool.util.js";

const ShareInput = ShareGrantRequestSchema;
const RevokeInput = z.object({
  grantId: z
    .string()
    .describe("Id of the grant (share) to revoke, from grant_list"),
});
const ListInput = z.object({
  resourceType: ShareResourceTypeSchema.describe("The shared object's type"),
  resourceId: z.string().describe("The shared object's id"),
});

export class GrantShareTool extends Tool<typeof ShareInput> {
  slug = "grant_share";
  name = "grant_share";
  description =
    "Shares a station or pin with an org member (or the whole team) at read or read-write access. read-write never conveys delete. The caller must be able to share the object.";

  get schema() {
    return ShareInput;
  }

  build(ctx: PermissionContext) {
    return tool({
      description: this.description,
      inputSchema: this.schema,
      execute: (input) =>
        runRbac(async () => {
          const req = this.validate(input);
          return {
            success: true,
            grant: await GrantService.share(ctx, req, AGENT_AUDIT),
          };
        }),
    });
  }
}

export class GrantRevokeTool extends Tool<typeof RevokeInput> {
  slug = "grant_revoke";
  name = "grant_revoke";
  description =
    "Revokes a share (removes every access a principal holds on the object via that grant). The caller must be able to share the object.";

  get schema() {
    return RevokeInput;
  }

  build(ctx: PermissionContext) {
    return tool({
      description: this.description,
      inputSchema: this.schema,
      execute: (input) =>
        runRbac(async () => {
          const { grantId } = this.validate(input);
          return {
            success: true,
            ...(await GrantService.revoke(ctx, grantId, AGENT_AUDIT)),
          };
        }),
    });
  }
}

export class GrantListTool extends Tool<typeof ListInput> {
  slug = "grant_list";
  name = "grant_list";
  description =
    "Lists who a station or pin is shared with and at what access. Use this to discover grant ids before revoking a share.";

  get schema() {
    return ListInput;
  }

  build(ctx: PermissionContext) {
    return tool({
      description: this.description,
      inputSchema: this.schema,
      execute: (input) =>
        runRbac(async () => {
          const { resourceType, resourceId } = this.validate(input);
          return {
            grants: await GrantService.list(ctx, resourceType, resourceId),
          };
        }),
    });
  }
}
