import { z } from "zod";
import { tool } from "ai";

import { PolicyUpsertRequestSchema } from "@portalai/core/contracts";

import { Tool } from "../../types/tools.js";
import { PolicyService } from "../../services/policy.service.js";
import type { PermissionContext } from "../../services/permission.service.js";
import { AGENT_AUDIT, runRbac } from "./rbac-tool.util.js";

const ListInput = z.object({});
const CreateInput = PolicyUpsertRequestSchema;
const UpdateInput = PolicyUpsertRequestSchema.extend({
  id: z.string().describe("Id of the custom policy to update"),
});
const DeleteInput = z.object({
  id: z.string().describe("Id of the custom policy to delete"),
});

export class PolicyListTool extends Tool<typeof ListInput> {
  slug = "policy_list";
  name = "policy_list";
  description =
    "Lists the organization's permission policies (system and custom), each with its statements. Use this to discover policy ids before attaching them to a role or group.";

  get schema() {
    return ListInput;
  }

  build(ctx: PermissionContext) {
    return tool({
      description: this.description,
      inputSchema: this.schema,
      execute: () =>
        runRbac(async () => ({ policies: await PolicyService.list(ctx) })),
    });
  }
}

export class PolicyCreateTool extends Tool<typeof CreateInput> {
  slug = "policy_create";
  name = "policy_create";
  description =
    "Creates a custom permission policy from one or more allow/deny statements. Each statement grants or denies a verb on a resource type (optionally a specific instance, optionally owner-scoped). Requires custom-RBAC entitlement and the member.role.assign capability.";

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
            policy: await PolicyService.create(ctx, req, AGENT_AUDIT),
          };
        }),
    });
  }
}

export class PolicyUpdateTool extends Tool<typeof UpdateInput> {
  slug = "policy_update";
  name = "policy_update";
  description =
    "Replaces a custom policy's name, description, and full statement set. System policies are immutable. Requires custom-RBAC entitlement and the member.role.assign capability.";

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
            policy: await PolicyService.update(ctx, id, req, AGENT_AUDIT),
          };
        }),
    });
  }
}

export class PolicyDeleteTool extends Tool<typeof DeleteInput> {
  slug = "policy_delete";
  name = "policy_delete";
  description =
    "Deletes a custom permission policy. System policies cannot be deleted. Requires custom-RBAC entitlement and the member.role.assign capability.";

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
            ...(await PolicyService.remove(ctx, id, AGENT_AUDIT)),
          };
        }),
    });
  }
}
