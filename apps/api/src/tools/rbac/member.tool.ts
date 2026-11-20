import { z } from "zod";
import { tool } from "ai";

import { Tool } from "../../types/tools.js";
import { SeatService } from "../../services/seat.service.js";
import { GroupService } from "../../services/group.service.js";
import type { PermissionContext } from "../../services/permission.service.js";
import { AGENT_AUDIT, runRbac } from "./rbac-tool.util.js";

const ListInput = z.object({});
const SetRolesInput = z.object({
  userId: z.string().describe("The member's user id"),
  roleSlugs: z
    .array(z.string().min(1))
    .min(1)
    .describe(
      "The complete set of role slugs (from role_list) to assign; replaces the member's current roles. At least one, and at least one system role."
    ),
});
const RemoveInput = z
  .object({
    userId: z
      .string()
      .min(1)
      .describe("The member's user id, from member_list"),
  })
  .strict();
const SeatUsageInput = z.object({}).strict();
const SetGroupsInput = z.object({
  userId: z.string().describe("The member's user id"),
  groupIds: z
    .array(z.string())
    .describe(
      "The complete set of group ids (from group_list); replaces the member's current groups"
    ),
});

export class MemberListTool extends Tool<typeof ListInput> {
  slug = "member_list";
  name = "member_list";
  description =
    "Lists the organization's members with each member's userId, email, name, system roles, all role slugs, and group ids. Use this to resolve a person (by email/name) to their userId before assigning roles/groups or sharing something with them, and to read a member's current role/group set before replacing it.";

  get schema() {
    return ListInput;
  }

  build(ctx: PermissionContext) {
    return tool({
      description: this.description,
      inputSchema: this.schema,
      execute: () =>
        runRbac(async () => ({ members: await SeatService.listMembers(ctx) })),
    });
  }
}

export class MemberSetRolesTool extends Tool<typeof SetRolesInput> {
  slug = "member_set_roles";
  name = "member_set_roles";
  description =
    "Sets a member's complete role assignment by role slug (the passed slugs replace their current roles). A member must keep at least one system role. Requires the member.role.assign capability.";

  get schema() {
    return SetRolesInput;
  }

  build(ctx: PermissionContext) {
    return tool({
      description: this.description,
      inputSchema: this.schema,
      execute: (input) =>
        runRbac(async () => {
          const { userId, roleSlugs } = this.validate(input);
          return {
            success: true,
            ...(await SeatService.setMemberRoles(
              ctx,
              userId,
              roleSlugs,
              AGENT_AUDIT
            )),
          };
        }),
    });
  }
}

export class MemberSetGroupsTool extends Tool<typeof SetGroupsInput> {
  slug = "member_set_groups";
  name = "member_set_groups";
  description =
    "Sets a member's complete group membership (the passed group ids replace their current groups). Requires custom-RBAC entitlement and the member.role.assign capability.";

  get schema() {
    return SetGroupsInput;
  }

  build(ctx: PermissionContext) {
    return tool({
      description: this.description,
      inputSchema: this.schema,
      execute: (input) =>
        runRbac(async () => {
          const { userId, groupIds } = this.validate(input);
          return {
            success: true,
            ...(await GroupService.setGroupsForUser(
              ctx,
              userId,
              groupIds,
              AGENT_AUDIT
            )),
          };
        }),
    });
  }
}

/**
 * `member_management` (#847): removes a member through
 * `SeatService.removeMember`, the Settings route's own path, so the last
 * owner can't be removed and the member's roles, groups and grants go with
 * them. Needs `member.remove`.
 */
export class MemberRemoveTool extends Tool<typeof RemoveInput> {
  slug = "member_remove";
  name = "member_remove";
  description =
    "Removes a member from the organization, with their roles, groups and grants. The last owner can't be removed. Resolve the person with member_list first. Needs member.remove.";

  get schema() {
    return RemoveInput;
  }

  build(ctx: PermissionContext) {
    return tool({
      description: this.description,
      inputSchema: this.schema,
      execute: (input) =>
        runRbac(async () => {
          const { userId } = this.validate(input);
          await SeatService.removeMember(ctx, userId, AGENT_AUDIT);
          return { success: true as const, userId };
        }),
    });
  }
}

/**
 * `member_management` (#847): the seat count Settings → Members shows,
 * members plus pending invitations against the plan's limit.
 */
export class SeatUsageTool extends Tool<typeof SeatUsageInput> {
  slug = "seat_usage";
  name = "seat_usage";
  description =
    "Returns the organization's seat usage: used (members plus pending invitations) and max (the plan's limit; null means unlimited).";

  get schema() {
    return SeatUsageInput;
  }

  build(ctx: PermissionContext) {
    return tool({
      description: this.description,
      inputSchema: this.schema,
      execute: () => runRbac(() => SeatService.seatUsage(ctx)),
    });
  }
}
