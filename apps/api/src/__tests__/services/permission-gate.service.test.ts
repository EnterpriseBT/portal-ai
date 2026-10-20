import { jest, describe, it, expect, beforeEach } from "@jest/globals";

import {
  wrapWithPermissionGate,
  permissionDenied,
  targetNotFound,
} from "../../services/permission-gate.service.js";
import { RbacObjectResolver } from "../../services/rbac-object-resolver.js";
import { ParentAccessService } from "../../services/parent-access.service.js";
import { ApiError } from "../../services/http.service.js";
import { ApiCode } from "../../constants/api-codes.constants.js";
import type { PermissionSet } from "../../services/permission-set.js";
import type { GateableTool } from "../../services/cost-gate.service.js";
import type { ToolAuthorization } from "@portalai/core/models";

const ctx = { organizationId: "org-1", userId: "u-1" };
/** A resolved child row; its parent is entity e-1 unless a test says so. */
const row = (createdBy: string, parentId: string | null = "e-1") => ({
  createdBy,
  parentId,
});

const tool = (execute: GateableTool["execute"]): GateableTool => ({ execute });
// #769: every entry carries a job lock; the permission gate ignores it.
const authIs =
  (a: Omit<ToolAuthorization, "lock"> | undefined) =>
  (): ToolAuthorization | undefined =>
    a && {
      ...a,
      lock: {
        target: "record",
        itemsArg: "items",
        idField: "connectorEntityId",
      },
    };

describe("wrapWithPermissionGate (#629)", () => {
  let can: jest.Mock;
  let set: PermissionSet;
  let firstRefusal: jest.SpiedFunction<typeof ParentAccessService.firstRefusal>;

  beforeEach(() => {
    jest.restoreAllMocks();
    can = jest.fn();
    set = { can } as unknown as PermissionSet;
    // #829: parents are writable unless a test says otherwise.
    firstRefusal = jest
      .spyOn(ParentAccessService, "firstRefusal")
      .mockResolvedValue(null);
  });

  it("create: allow runs the tool and checks write with createdBy = the caller", async () => {
    can.mockReturnValue(true);
    const inner = jest.fn(async () => "ok");
    const tools: Record<string, GateableTool> = { fm_create: tool(inner) };
    wrapWithPermissionGate(
      tools,
      set,
      ctx,
      authIs({
        verb: "write",
        resourceType: "field_mapping",
        mode: "create",
        parentPaths: ["items[].connectorEntityId"],
      })
    );
    const r = await tools.fm_create.execute!(
      { items: [{ connectorEntityId: "e-1" }] },
      { toolCallId: "t" }
    );
    expect(r).toBe("ok");
    // The new rows are caller-owned, so a member's created_by_caller write
    // must permit their own creates — the check carries createdBy = caller.
    expect(can).toHaveBeenCalledWith("resource.write", {
      type: "field_mapping",
      createdBy: "u-1",
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
      authIs({
        verb: "write",
        resourceType: "field_mapping",
        mode: "create",
        parentPaths: ["items[].connectorEntityId"],
      })
    );
    const r = await tools.fm_create.execute!(
      { items: [{ connectorEntityId: "e-1" }] },
      {}
    );
    expect(r).toHaveProperty("error.code", ApiCode.TOOL_PERMISSION_DENIED);
    expect(inner).not.toHaveBeenCalled();
  });

  it("single: allows when the caller's set permits the resolved object", async () => {
    jest.spyOn(RbacObjectResolver, "resolveRow").mockResolvedValue(row("u-1"));
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
    expect(RbacObjectResolver.resolveRow).toHaveBeenCalledWith(
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
      .spyOn(RbacObjectResolver, "resolveRow")
      .mockResolvedValue(row("u-other"));
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
    jest.spyOn(RbacObjectResolver, "resolveRow").mockResolvedValue(null);
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

  it("batch: allows only when every item passes (checks each per object)", async () => {
    jest.spyOn(RbacObjectResolver, "resolveRow").mockResolvedValue(row("u-1"));
    can.mockReturnValue(true);
    const inner = jest.fn(async () => "batch-ok");
    const tools: Record<string, GateableTool> = { fm_update: tool(inner) };
    wrapWithPermissionGate(
      tools,
      set,
      ctx,
      authIs({
        verb: "write",
        resourceType: "field_mapping",
        mode: "batch",
        itemsArg: "items",
        idField: "fieldMappingId",
      })
    );
    const r = await tools.fm_update.execute!(
      { items: [{ fieldMappingId: "a" }, { fieldMappingId: "b" }] },
      {}
    );
    expect(r).toBe("batch-ok");
    expect(RbacObjectResolver.resolveRow).toHaveBeenCalledTimes(2);
  });

  it("batch: denies the whole call if any item fails", async () => {
    jest.spyOn(RbacObjectResolver, "resolveRow").mockResolvedValue(row("u-x"));
    can.mockReturnValueOnce(true).mockReturnValueOnce(false);
    const inner = jest.fn();
    const tools: Record<string, GateableTool> = { fm_update: tool(inner) };
    wrapWithPermissionGate(
      tools,
      set,
      ctx,
      authIs({
        verb: "write",
        resourceType: "field_mapping",
        mode: "batch",
        itemsArg: "items",
        idField: "fieldMappingId",
      })
    );
    const r = await tools.fm_update.execute!(
      { items: [{ fieldMappingId: "a" }, { fieldMappingId: "b" }] },
      {}
    );
    expect(r).toHaveProperty("error.code", ApiCode.TOOL_PERMISSION_DENIED);
    // #711 (spec case 7): the same wording as the API's refusals.
    expect(r).toHaveProperty(
      "error.message",
      "You don't have permission to write this field_mapping."
    );
    expect(inner).not.toHaveBeenCalled();
  });

  it("catches an ApiError(403) thrown in execute (an rbac tool's service gate)", async () => {
    const tools: Record<string, GateableTool> = {
      policy_create: tool(async () => {
        throw new ApiError(403, ApiCode.PERMISSION_DENIED, "not allowed");
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

  it("bulk: a class-level (no-createdBy) write check gates the whole-entity scan", async () => {
    // An admin's unconditional write satisfies a class-level check → allowed.
    can.mockReturnValue(true);
    const inner = jest.fn(async () => "bulk-ok");
    const tools: Record<string, GateableTool> = { rec_bulk: tool(inner) };
    wrapWithPermissionGate(
      tools,
      set,
      ctx,
      authIs({
        verb: "write",
        resourceType: "entity_record",
        mode: "bulk",
        parentPaths: ["connectorEntityId"],
      })
    );
    const r = await tools.rec_bulk.execute!({ connectorEntityId: "e-1" }, {});
    expect(r).toBe("bulk-ok");
    // No object id, no createdBy — only an unconditional grant passes. This is
    // one check with zero per-row work (the O(1) invariant for scanners).
    expect(can).toHaveBeenCalledTimes(1);
    expect(can).toHaveBeenCalledWith("resource.write", {
      type: "entity_record",
    });
  });

  it("bulk: a member's conditional write fails the class-level check (admin-only)", async () => {
    // A member's created_by_caller write does NOT satisfy a class-level check
    // (no createdBy to match), so the resolver returns false → denied.
    can.mockReturnValue(false);
    const inner = jest.fn();
    const tools: Record<string, GateableTool> = { rec_bulk: tool(inner) };
    wrapWithPermissionGate(
      tools,
      set,
      ctx,
      authIs({
        verb: "write",
        resourceType: "entity_record",
        mode: "bulk",
        parentPaths: ["connectorEntityId"],
      })
    );
    const r = await tools.rec_bulk.execute!({ connectorEntityId: "e-1" }, {});
    expect(r).toHaveProperty("error.code", ApiCode.TOOL_PERMISSION_DENIED);
    expect(inner).not.toHaveBeenCalled();
  });

  it("O(1) invariant: a bulk scan resolves zero objects regardless of table size", async () => {
    // The gate must not scale its permission work with the scanned set — a
    // whole-entity bulk does exactly one in-memory `can` and never resolves a
    // per-row `createdBy`, so cost is independent of how many rows the job
    // ultimately touches (the user's performance concern for portal sessions).
    const resolveSpy = jest.spyOn(RbacObjectResolver, "resolveRow");
    can.mockReturnValue(true);
    const tools: Record<string, GateableTool> = {
      rec_bulk: tool(async () => "ok"),
    };
    wrapWithPermissionGate(
      tools,
      set,
      ctx,
      authIs({
        verb: "write",
        resourceType: "entity_record",
        mode: "bulk",
        parentPaths: ["connectorEntityId"],
      })
    );
    await tools.rec_bulk.execute!({ connectorEntityId: "e-1" }, {});
    expect(resolveSpy).not.toHaveBeenCalled();
    expect(can).toHaveBeenCalledTimes(1);
  });

  it("fail-closed: a resolver error denies", async () => {
    jest
      .spyOn(RbacObjectResolver, "resolveRow")
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

  // ── #829: a child write needs write on its parent ───────────────────

  const createAuth = authIs({
    verb: "write",
    resourceType: "field_mapping",
    mode: "create",
    parentPaths: ["items[].connectorEntityId"],
  });

  it("create: an unreadable parent answers TOOL_TARGET_NOT_FOUND and never runs", async () => {
    can.mockReturnValue(true);
    firstRefusal.mockResolvedValue({ id: "e-x", reason: "not_found" });
    const inner = jest.fn();
    const tools: Record<string, GateableTool> = { fm_create: tool(inner) };
    wrapWithPermissionGate(tools, set, ctx, createAuth);
    const r = await tools.fm_create.execute!(
      { items: [{ connectorEntityId: "e-x" }] },
      {}
    );
    expect(r).toEqual({
      error: {
        code: ApiCode.TOOL_TARGET_NOT_FOUND,
        message: "Entity e-x was not found.",
      },
    });
    expect(inner).not.toHaveBeenCalled();
  });

  it("create: a read-only parent answers TOOL_PERMISSION_DENIED naming it", async () => {
    can.mockReturnValue(true);
    firstRefusal.mockResolvedValue({ id: "e-sys", reason: "denied" });
    const inner = jest.fn();
    const tools: Record<string, GateableTool> = { fm_create: tool(inner) };
    wrapWithPermissionGate(tools, set, ctx, createAuth);
    const r = await tools.fm_create.execute!(
      { items: [{ connectorEntityId: "e-sys" }] },
      {}
    );
    expect(r).toEqual({
      error: {
        code: ApiCode.TOOL_PERMISSION_DENIED,
        message: "You don't have permission to edit entity e-sys.",
      },
    });
    expect(inner).not.toHaveBeenCalled();
  });

  it("create: checks write on every item's parent in one call, then the owned create", async () => {
    can.mockReturnValue(true);
    const inner = jest.fn(async () => "ok");
    const tools: Record<string, GateableTool> = { fm_create: tool(inner) };
    wrapWithPermissionGate(tools, set, ctx, createAuth);
    const r = await tools.fm_create.execute!(
      { items: [{ connectorEntityId: "e-1" }, { connectorEntityId: "e-2" }] },
      {}
    );
    expect(r).toBe("ok");
    expect(firstRefusal).toHaveBeenCalledTimes(1);
    expect(firstRefusal).toHaveBeenCalledWith(
      set,
      "org-1",
      "entity",
      ["e-1", "e-2"],
      "write"
    );
  });

  it("create: one bad parent among two refuses the whole call", async () => {
    can.mockReturnValue(true);
    firstRefusal.mockResolvedValue({ id: "e-2", reason: "denied" });
    const inner = jest.fn();
    const tools: Record<string, GateableTool> = { fm_create: tool(inner) };
    wrapWithPermissionGate(tools, set, ctx, createAuth);
    const r = await tools.fm_create.execute!(
      { items: [{ connectorEntityId: "e-1" }, { connectorEntityId: "e-2" }] },
      {}
    );
    expect(r).toHaveProperty("error.code", ApiCode.TOOL_PERMISSION_DENIED);
    expect(inner).not.toHaveBeenCalled();
  });

  it("create: no parent ids in the input is denied without a lookup", async () => {
    can.mockReturnValue(true);
    const inner = jest.fn();
    const tools: Record<string, GateableTool> = { fm_create: tool(inner) };
    wrapWithPermissionGate(tools, set, ctx, createAuth);
    const r = await tools.fm_create.execute!({ items: [] }, {});
    expect(r).toHaveProperty("error.code", ApiCode.TOOL_PERMISSION_DENIED);
    expect(firstRefusal).not.toHaveBeenCalled();
    expect(inner).not.toHaveBeenCalled();
  });

  const batchAuth = authIs({
    verb: "write",
    resourceType: "field_mapping",
    mode: "batch",
    itemsArg: "items",
    idField: "fieldMappingId",
  });

  it("batch: a child the caller may write under a read-only parent is denied", async () => {
    jest
      .spyOn(RbacObjectResolver, "resolveRow")
      .mockResolvedValue(row("u-1", "e-sys"));
    can.mockReturnValue(true);
    firstRefusal.mockResolvedValue({ id: "e-sys", reason: "denied" });
    const inner = jest.fn();
    const tools: Record<string, GateableTool> = { fm_update: tool(inner) };
    wrapWithPermissionGate(tools, set, ctx, batchAuth);
    const r = await tools.fm_update.execute!(
      { items: [{ fieldMappingId: "fm-1" }] },
      {}
    );
    expect(r).toHaveProperty("error.code", ApiCode.TOOL_PERMISSION_DENIED);
    expect(inner).not.toHaveBeenCalled();
  });

  it("batch: the parent comes from the stored row, never from the input", async () => {
    jest
      .spyOn(RbacObjectResolver, "resolveRow")
      .mockResolvedValue(row("u-1", "e-stored"));
    can.mockReturnValue(true);
    const tools: Record<string, GateableTool> = {
      fm_update: tool(async () => "ok"),
    };
    wrapWithPermissionGate(tools, set, ctx, batchAuth);
    await tools.fm_update.execute!(
      {
        items: [{ fieldMappingId: "fm-1", connectorEntityId: "e-claimed" }],
      },
      {}
    );
    expect(firstRefusal).toHaveBeenCalledWith(
      set,
      "org-1",
      "entity",
      ["e-stored"],
      "write"
    );
  });

  const bulkAuth = authIs({
    verb: "write",
    resourceType: "entity_record",
    mode: "bulk",
    parentPaths: ["expression.writes[].targetConnectorEntityId"],
    readPaths: ["sourceConnectorEntityId"],
  });
  const transformInput = {
    sourceConnectorEntityId: "e-src",
    expression: {
      writes: [
        { targetConnectorEntityId: "e-1" },
        { targetConnectorEntityId: "e-2" },
      ],
    },
  };

  it("bulk: a read-only write target is denied", async () => {
    can.mockReturnValue(true);
    firstRefusal.mockImplementation(async (_s, _o, _t, _ids, verb) =>
      verb === "write" ? { id: "e-2", reason: "denied" } : null
    );
    const inner = jest.fn();
    const tools: Record<string, GateableTool> = { transform: tool(inner) };
    wrapWithPermissionGate(tools, set, ctx, bulkAuth);
    const r = await tools.transform.execute!(transformInput, {});
    expect(r).toHaveProperty("error.code", ApiCode.TOOL_PERMISSION_DENIED);
    expect(inner).not.toHaveBeenCalled();
  });

  it("bulk: an unreadable source answers not found before any write check", async () => {
    can.mockReturnValue(true);
    firstRefusal.mockImplementation(async (_s, _o, _t, _ids, verb) =>
      verb === "read" ? { id: "e-src", reason: "not_found" } : null
    );
    const inner = jest.fn();
    const tools: Record<string, GateableTool> = { transform: tool(inner) };
    wrapWithPermissionGate(tools, set, ctx, bulkAuth);
    const r = await tools.transform.execute!(transformInput, {});
    expect(r).toHaveProperty("error.code", ApiCode.TOOL_TARGET_NOT_FOUND);
    expect(firstRefusal).toHaveBeenCalledTimes(1);
    expect(inner).not.toHaveBeenCalled();
  });

  it("bulk: readable source and writable targets run, after the class-level check", async () => {
    can.mockReturnValue(true);
    const inner = jest.fn(async () => "queued");
    const tools: Record<string, GateableTool> = { transform: tool(inner) };
    wrapWithPermissionGate(tools, set, ctx, bulkAuth);
    expect(await tools.transform.execute!(transformInput, {})).toBe("queued");
    expect(firstRefusal).toHaveBeenNthCalledWith(
      1,
      set,
      "org-1",
      "entity",
      ["e-src"],
      "read"
    );
    expect(firstRefusal).toHaveBeenNthCalledWith(
      2,
      set,
      "org-1",
      "entity",
      ["e-1", "e-2"],
      "write"
    );
    expect(can).toHaveBeenCalledWith("resource.write", {
      type: "entity_record",
    });
  });

  it("fail-closed: a parent lookup error denies", async () => {
    can.mockReturnValue(true);
    firstRefusal.mockRejectedValue(new Error("db down"));
    const inner = jest.fn();
    const tools: Record<string, GateableTool> = { fm_create: tool(inner) };
    wrapWithPermissionGate(tools, set, ctx, createAuth);
    const r = await tools.fm_create.execute!(
      { items: [{ connectorEntityId: "e-1" }] },
      {}
    );
    expect(r).toHaveProperty("error.code", ApiCode.TOOL_PERMISSION_DENIED);
    expect(inner).not.toHaveBeenCalled();
  });

  it("targetNotFound() carries the typed code", () => {
    expect(targetNotFound("x")).toEqual({
      error: { code: ApiCode.TOOL_TARGET_NOT_FOUND, message: "x" },
    });
  });
});
