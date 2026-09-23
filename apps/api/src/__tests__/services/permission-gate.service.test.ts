import { jest, describe, it, expect, beforeEach } from "@jest/globals";

import {
  wrapWithPermissionGate,
  permissionDenied,
} from "../../services/permission-gate.service.js";
import { RbacObjectResolver } from "../../services/rbac-object-resolver.js";
import { ApiError } from "../../services/http.service.js";
import { ApiCode } from "../../constants/api-codes.constants.js";
import type { PermissionSet } from "../../services/permission-set.js";
import type { GateableTool } from "../../services/cost-gate.service.js";
import type { ToolAuthorization } from "@portalai/core/models";

const ctx = { organizationId: "org-1", userId: "u-1" };

const tool = (execute: GateableTool["execute"]): GateableTool => ({ execute });
const authIs =
  (a: ToolAuthorization | undefined) => (): ToolAuthorization | undefined =>
    a;

describe("wrapWithPermissionGate (#629)", () => {
  let can: jest.Mock;
  let set: PermissionSet;

  beforeEach(() => {
    jest.restoreAllMocks();
    can = jest.fn();
    set = { can } as unknown as PermissionSet;
  });

  it("create: allow runs the tool and checks the type-level write", async () => {
    can.mockReturnValue(true);
    const inner = jest.fn(async () => "ok");
    const tools: Record<string, GateableTool> = { fm_create: tool(inner) };
    wrapWithPermissionGate(
      tools,
      set,
      ctx,
      authIs({ verb: "write", resourceType: "field_mapping", mode: "create" })
    );
    const r = await tools.fm_create.execute!({}, { toolCallId: "t" });
    expect(r).toBe("ok");
    expect(can).toHaveBeenCalledWith("resource.write", {
      type: "field_mapping",
    });
  });

  it("create: deny returns a typed refusal and never runs the tool", async () => {
    can.mockReturnValue(false);
    const inner = jest.fn(async () => "ok");
    const tools: Record<string, GateableTool> = { fm_create: tool(inner) };
    wrapWithPermissionGate(
      tools,
      set,
      ctx,
      authIs({ verb: "write", resourceType: "field_mapping", mode: "create" })
    );
    const r = await tools.fm_create.execute!({}, {});
    expect(r).toHaveProperty("error.code", ApiCode.TOOL_PERMISSION_DENIED);
    expect(inner).not.toHaveBeenCalled();
  });

  it("single: allows when the caller's set permits the resolved object", async () => {
    jest.spyOn(RbacObjectResolver, "resolveCreatedBy").mockResolvedValue("u-1");
    can.mockReturnValue(true);
    const inner = jest.fn(async () => "edited");
    const tools: Record<string, GateableTool> = { fm_update: tool(inner) };
    wrapWithPermissionGate(
      tools,
      set,
      ctx,
      authIs({
        verb: "write",
        resourceType: "field_mapping",
        mode: "single",
        targetIdArg: "id",
      })
    );
    const r = await tools.fm_update.execute!({ id: "fm-9" }, {});
    expect(r).toBe("edited");
    expect(RbacObjectResolver.resolveCreatedBy).toHaveBeenCalledWith(
      "org-1",
      "field_mapping",
      "fm-9"
    );
    expect(can).toHaveBeenCalledWith("resource.write", {
      type: "field_mapping",
      id: "fm-9",
      createdBy: "u-1",
    });
  });

  it("single: denies when the per-object check fails", async () => {
    jest
      .spyOn(RbacObjectResolver, "resolveCreatedBy")
      .mockResolvedValue("u-other");
    can.mockReturnValue(false);
    const inner = jest.fn();
    const tools: Record<string, GateableTool> = { fm_update: tool(inner) };
    wrapWithPermissionGate(
      tools,
      set,
      ctx,
      authIs({
        verb: "write",
        resourceType: "field_mapping",
        mode: "single",
        targetIdArg: "id",
      })
    );
    const r = await tools.fm_update.execute!({ id: "fm-9" }, {});
    expect(r).toHaveProperty("error.code", ApiCode.TOOL_PERMISSION_DENIED);
    expect(inner).not.toHaveBeenCalled();
  });

  it("single: an unresolvable target (null) is denied without a check", async () => {
    jest.spyOn(RbacObjectResolver, "resolveCreatedBy").mockResolvedValue(null);
    const inner = jest.fn();
    const tools: Record<string, GateableTool> = { fm_update: tool(inner) };
    wrapWithPermissionGate(
      tools,
      set,
      ctx,
      authIs({
        verb: "write",
        resourceType: "field_mapping",
        mode: "single",
        targetIdArg: "id",
      })
    );
    const r = await tools.fm_update.execute!({ id: "gone" }, {});
    expect(r).toHaveProperty("error.code", ApiCode.TOOL_PERMISSION_DENIED);
    expect(can).not.toHaveBeenCalled();
    expect(inner).not.toHaveBeenCalled();
  });

  it("catches an ApiError(403) thrown in execute (an rbac tool's service gate)", async () => {
    const tools: Record<string, GateableTool> = {
      policy_create: tool(async () => {
        throw new ApiError(403, ApiCode.INSUFFICIENT_ROLE, "not allowed");
      }),
    };
    // rbac_management tools carry no descriptor — they rely on this catch.
    wrapWithPermissionGate(tools, set, ctx, authIs(undefined));
    const r = await tools.policy_create.execute!({}, {});
    expect(r).toEqual({
      error: { code: ApiCode.TOOL_PERMISSION_DENIED, message: "not allowed" },
    });
    expect(can).not.toHaveBeenCalled();
  });

  it("rethrows a non-403 error", async () => {
    const boom = new Error("kaboom");
    const tools: Record<string, GateableTool> = {
      t: tool(async () => {
        throw boom;
      }),
    };
    wrapWithPermissionGate(tools, set, ctx, authIs(undefined));
    await expect(tools.t.execute!({}, {})).rejects.toBe(boom);
  });

  it("bulk: no pre-flight (the tool self-scopes) but a 403 still surfaces", async () => {
    const inner = jest.fn(async () => "bulk-ok");
    const tools: Record<string, GateableTool> = { rec_bulk: tool(inner) };
    wrapWithPermissionGate(
      tools,
      set,
      ctx,
      authIs({ verb: "write", resourceType: "entity_record", mode: "bulk" })
    );
    const r = await tools.rec_bulk.execute!({}, {});
    expect(r).toBe("bulk-ok");
    expect(can).not.toHaveBeenCalled();
  });

  it("fail-closed: a resolver error denies", async () => {
    jest
      .spyOn(RbacObjectResolver, "resolveCreatedBy")
      .mockRejectedValue(new Error("db down"));
    const inner = jest.fn();
    const tools: Record<string, GateableTool> = { fm_update: tool(inner) };
    wrapWithPermissionGate(
      tools,
      set,
      ctx,
      authIs({
        verb: "write",
        resourceType: "field_mapping",
        mode: "single",
        targetIdArg: "id",
      })
    );
    const r = await tools.fm_update.execute!({ id: "fm-9" }, {});
    expect(r).toHaveProperty("error.code", ApiCode.TOOL_PERMISSION_DENIED);
    expect(inner).not.toHaveBeenCalled();
  });

  it("permissionDenied() carries the typed code", () => {
    expect(permissionDenied("x")).toEqual({
      error: { code: ApiCode.TOOL_PERMISSION_DENIED, message: "x" },
    });
  });
});
