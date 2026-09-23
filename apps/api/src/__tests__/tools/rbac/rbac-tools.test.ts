import { jest, describe, it, expect, beforeEach } from "@jest/globals";

import { ApiError } from "../../../services/http.service.js";
import { ApiCode } from "../../../constants/api-codes.constants.js";
import type { PermissionContext } from "../../../services/permission.service.js";

/**
 * Unit coverage for the rbac_management tools (#629 slice 3). Each tool is a
 * thin wrapper that routes to a self-gating RBAC service; these tests pin the
 * two behaviors the gate depends on: a 403 from the service **propagates** (so
 * `wrapWithPermissionGate` converts it to TOOL_PERMISSION_DENIED), while any
 * other failure is returned as a relayable `{ error }` tool result.
 */

const policyCreate = jest.fn<(...args: unknown[]) => Promise<unknown>>();
const policyList = jest.fn<(...args: unknown[]) => Promise<unknown>>();
jest.unstable_mockModule("../../../services/policy.service.js", () => ({
  PolicyService: { create: policyCreate, list: policyList },
}));

const grantShare = jest.fn<(...args: unknown[]) => Promise<unknown>>();
jest.unstable_mockModule("../../../services/grant.service.js", () => ({
  GrantService: { share: grantShare },
}));

const setMemberRoles = jest.fn<(...args: unknown[]) => Promise<unknown>>();
const listMembers = jest.fn<(...args: unknown[]) => Promise<unknown>>();
jest.unstable_mockModule("../../../services/seat.service.js", () => ({
  SeatService: { setMemberRoles, listMembers },
}));

const { PolicyCreateTool, PolicyListTool } =
  await import("../../../tools/rbac/policy.tool.js");
const { GrantShareTool } = await import("../../../tools/rbac/grant.tool.js");
const { MemberSetRolesTool, MemberListTool } =
  await import("../../../tools/rbac/member.tool.js");

const ctx: PermissionContext = {
  userId: "u-1",
  organizationId: "org-1",
  roles: [],
};

type Executable = { execute: (i: unknown, o: unknown) => Promise<unknown> };
const exec = (built: unknown, input: unknown) =>
  (built as Executable).execute(input, { toolCallId: "t", messages: [] });

const validStatements = [
  {
    effect: "allow" as const,
    verb: "read" as const,
    resourceType: "station" as const,
    resourceId: null,
    condition: null,
  },
];

describe("rbac_management tools (#629)", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("policy_list routes to PolicyService.list and returns the policies", async () => {
    policyList.mockResolvedValue([{ id: "pol_1" }]);
    const r = await exec(new PolicyListTool().build(ctx), {});
    expect(policyList).toHaveBeenCalledWith(ctx);
    expect(r).toEqual({ policies: [{ id: "pol_1" }] });
  });

  it("policy_create routes to the service with the caller ctx + the agent audit stamp", async () => {
    policyCreate.mockResolvedValue({ id: "pol_9", name: "P" });
    const input = { name: "P", statements: validStatements };
    const r = await exec(new PolicyCreateTool().build(ctx), input);
    expect(policyCreate).toHaveBeenCalledWith(ctx, input, {
      sourceIp: null,
      userAgent: "portal-agent",
    });
    expect(r).toEqual({ success: true, policy: { id: "pol_9", name: "P" } });
  });

  it("a 403 from the service PROPAGATES (so the gate surfaces the denial)", async () => {
    policyCreate.mockRejectedValue(
      new ApiError(403, ApiCode.INSUFFICIENT_ROLE, "not allowed")
    );
    await expect(
      exec(new PolicyCreateTool().build(ctx), {
        name: "P",
        statements: validStatements,
      })
    ).rejects.toBeInstanceOf(ApiError);
  });

  it("a non-403 service error is returned as a relayable { error }", async () => {
    policyCreate.mockRejectedValue(
      new ApiError(404, ApiCode.POLICY_NOT_FOUND, "policy not found")
    );
    const r = await exec(new PolicyCreateTool().build(ctx), {
      name: "P",
      statements: validStatements,
    });
    expect(r).toEqual({ error: "policy not found" });
  });

  it("invalid input is returned as { error }, not a throw", async () => {
    const r = (await exec(new PolicyCreateTool().build(ctx), {
      name: "",
      statements: [],
    })) as { error?: string };
    expect(r.error).toBeDefined();
    expect(policyCreate).not.toHaveBeenCalled();
  });

  it("grant_share routes to GrantService.share with the caller ctx", async () => {
    grantShare.mockResolvedValue({ id: "g_1" });
    const input = {
      resourceType: "station" as const,
      resourceId: "st_1",
      grantee: { type: "team" as const },
      access: "read" as const,
    };
    const r = await exec(new GrantShareTool().build(ctx), input);
    expect(grantShare).toHaveBeenCalledWith(ctx, input, {
      sourceIp: null,
      userAgent: "portal-agent",
    });
    expect(r).toEqual({ success: true, grant: { id: "g_1" } });
  });

  it("member_list routes to SeatService.listMembers and returns the roster", async () => {
    listMembers.mockResolvedValue([
      {
        userId: "u-2",
        email: "b@x.com",
        roles: ["member"],
        roleSlugs: ["member"],
      },
    ]);
    const r = await exec(new MemberListTool().build(ctx), {});
    expect(listMembers).toHaveBeenCalledWith(ctx);
    expect(r).toEqual({
      members: [
        {
          userId: "u-2",
          email: "b@x.com",
          roles: ["member"],
          roleSlugs: ["member"],
        },
      ],
    });
  });

  it("member_set_roles routes to SeatService.setMemberRoles by slug", async () => {
    setMemberRoles.mockResolvedValue({
      userId: "u-2",
      roles: ["member"],
      roleSlugs: ["member", "analyst"],
    });
    const r = await exec(new MemberSetRolesTool().build(ctx), {
      userId: "u-2",
      roleSlugs: ["member", "analyst"],
    });
    expect(setMemberRoles).toHaveBeenCalledWith(
      ctx,
      "u-2",
      ["member", "analyst"],
      { sourceIp: null, userAgent: "portal-agent" }
    );
    expect(r).toMatchObject({
      success: true,
      roleSlugs: ["member", "analyst"],
    });
  });
});
