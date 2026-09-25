import { z } from "zod";
import { tool } from "ai";

import { GroupUpsertRequestSchema } from "@portalai/core/contracts";

import { Tool } from "../../types/tools.js";
import { GroupService } from "../../services/group.service.js";
import type { PermissionContext } from "../../services/permission.service.js";
import { AGENT_AUDIT, runRbac } from "./rbac-tool.util.js";

const ListInput = z.object({});
const CreateInput = GroupUpsertRequestSchema;
const UpdateInput = GroupUpsertRequestSchema.extend({
  id: z.string().describe("Id of the group to update"),
});
const DeleteInput = z.object({
  id: z.string().describe("Id of the group to delete"),
});
const SetMembersInput = z.object({
  id: z.string().describe("Id of the group whose membership to set"),
  userIds: z
    .array(z.string())
    .describe(
      "The complete set of member user ids (replaces the group's membership)"
    ),
});

export class GroupListTool extends Tool<typeof ListInput> {
  slug = "group_list";
  name = "group_list";
  description =
    "Lists the organization's groups with each group's attached policy ids and live member count. Use this to discover group ids before setting a member's groups.";

  get schema() {
    return ListInput;
  }

  build(ctx: PermissionContext) {
    return tool({
      description: this.description,
      inputSchema: this.schema,
      execute: () =>
        runRbac(async () => ({ groups: await GroupService.list(ctx) })),
    });
  }
}

export class GroupCreateTool extends Tool<typeof CreateInput> {
  slug = "group_create";
  name = "group_create";
  description =
    "Creates a group that bundles a set of existing policies (by id); members of the group inherit them. Membership is set separately with group_set_members. Requires custom-RBAC entitlement and the member.role.assign capability.";

  get schema() {
    return CreateInput;
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
            group: await GroupService.create(ctx, req, AGENT_AUDIT),
          };
        }),
    });
  }
}

export class GroupUpdateTool extends Tool<typeof UpdateInput> {
  slug = "group_update";
  name = "group_update";
  description =
    "Replaces a group's name, description, and attached policy set. Requires custom-RBAC entitlement and the member.role.assign capability.";

  get schema() {
    return UpdateInput;
  }

  build(ctx: PermissionContext) {
    return tool({
      description: this.description,
      inputSchema: this.schema,
      execute: (input) =>
        runRbac(async () => {
          const { id, ...req } = this.validate(input);
          return {
            success: true,
            group: await GroupService.update(ctx, id, req, AGENT_AUDIT),
          };
        }),
    });
  }
}

export class GroupDeleteTool extends Tool<typeof DeleteInput> {
  slug = "group_delete";
  name = "group_delete";
  description =
    "Deletes a group. Requires custom-RBAC entitlement and the member.role.assign capability.";

  get schema() {
    return DeleteInput;
  }

  build(ctx: PermissionContext) {
    return tool({
      description: this.description,
      inputSchema: this.schema,
      execute: (input) =>
        runRbac(async () => {
          const { id } = this.validate(input);
          return {
            success: true,
            ...(await GroupService.remove(ctx, id, AGENT_AUDIT)),
          };
        }),
    });
  }
}

export class GroupSetMembersTool extends Tool<typeof SetMembersInput> {
  slug = "group_set_members";
  name = "group_set_members";
  description =
    "Sets a group's complete membership (the passed user ids replace the current members). Requires custom-RBAC entitlement and the member.role.assign capability.";

  get schema() {
    return SetMembersInput;
  }

  build(ctx: PermissionContext) {
    return tool({
      description: this.description,
      inputSchema: this.schema,
      execute: (input) =>
        runRbac(async () => {
          const { id, userIds } = this.validate(input);
          return {
            success: true,
            group: await GroupService.setMembers(ctx, id, userIds, AGENT_AUDIT),
          };
        }),
    });
  }
}
