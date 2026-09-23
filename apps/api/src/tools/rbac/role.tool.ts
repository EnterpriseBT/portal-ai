import { z } from "zod";
import { tool } from "ai";

import { RoleUpsertRequestSchema } from "@portalai/core/contracts";

import { Tool } from "../../types/tools.js";
import { RoleService } from "../../services/role.service.js";
import type { PermissionContext } from "../../services/permission.service.js";
import { AGENT_AUDIT, runRbac } from "./rbac-tool.util.js";

const ListInput = z.object({});
const CreateInput = RoleUpsertRequestSchema;
const UpdateInput = RoleUpsertRequestSchema.extend({
  id: z.string().describe("Id of the custom role to update"),
});
const DeleteInput = z.object({
  id: z.string().describe("Id of the custom role to delete"),
});

export class RoleListTool extends Tool<typeof ListInput> {
  slug = "role_list";
  name = "role_list";
  description =
    "Lists the organization's roles (system and custom) with each role's stable assignment slug and attached policy ids. Use this to discover role slugs before assigning them to a member.";

  get schema() {
    return ListInput;
  }

  build(ctx: PermissionContext) {
    return tool({
      description: this.description,
      inputSchema: this.schema,
      execute: () =>
        runRbac(async () => ({ roles: await RoleService.list(ctx) })),
    });
  }
}

export class RoleCreateTool extends Tool<typeof CreateInput> {
  slug = "role_create";
  name = "role_create";
  description =
    "Creates a custom role bundling a set of existing policies (by id). Members assigned the role inherit its policies. Requires custom-RBAC entitlement and the member.role.assign capability.";

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
            role: await RoleService.create(ctx, req, AGENT_AUDIT),
          };
        }),
    });
  }
}

export class RoleUpdateTool extends Tool<typeof UpdateInput> {
  slug = "role_update";
  name = "role_update";
  description =
    "Replaces a custom role's name and its attached policy set. System roles are immutable. Requires custom-RBAC entitlement and the member.role.assign capability.";

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
            role: await RoleService.update(ctx, id, req, AGENT_AUDIT),
          };
        }),
    });
  }
}

export class RoleDeleteTool extends Tool<typeof DeleteInput> {
  slug = "role_delete";
  name = "role_delete";
  description =
    "Deletes a custom role. System roles cannot be deleted. Requires custom-RBAC entitlement and the member.role.assign capability.";

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
            ...(await RoleService.remove(ctx, id, AGENT_AUDIT)),
          };
        }),
    });
  }
}
