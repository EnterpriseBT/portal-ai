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
/** A resolved object row; `containerId` is set for a contained type. */
const row = (createdBy: string, containerId: string | null = null) => ({
  createdBy,
  containerId,
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
    // #829: owners and containers are writable unless a test says otherwise.
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
        resourceType: "station",
        mode: "create",
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
      type: "station",
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
        resourceType: "station",
        mode: "create",
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
        resourceType: "station",
        mode: "single",
        targetIdArg: "id",
      })
    );
    const r = await tools.fm_update.execute!({ id: "fm-9" }, {});
    expect(r).toBe("edited");
    expect(RbacObjectResolver.resolveRow).toHaveBeenCalledWith(
      "org-1",
      "station",
      "fm-9"
    );
    expect(can).toHaveBeenCalledWith("resource.write", {
      type: "station",
      id: "fm-9",
      createdBy: "u-1",
    });
  });

  it("single: denies when the per-object check fails", async () => {
    jest
      .spyOn(RbacObjectResolver, "resolveRow")
      .mockResolvedValue(row("u-other"));
    // Readable, not writable.
    can.mockImplementation((action: unknown) => action === "resource.read");
    const inner = jest.fn();
    const tools: Record<string, GateableTool> = { fm_update: tool(inner) };
    wrapWithPermissionGate(
      tools,
      set,
      ctx,
      authIs({
        verb: "write",
        resourceType: "station",
        mode: "single",
        targetIdArg: "id",
      })
    );
    const r = await tools.fm_update.execute!({ id: "fm-9" }, {});
    expect(r).toEqual(
      permissionDenied("You don't have permission to write station fm-9.")
    );
    expect(inner).not.toHaveBeenCalled();
  });

  it("#835 single: a target the caller can't read answers not found, like an absent one", async () => {
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
        resourceType: "station",
        mode: "single",
        targetIdArg: "id",
      })
    );
    const r = await tools.fm_update.execute!({ id: "s-hidden" }, {});
    expect(r).toEqual(targetNotFound("Station s-hidden was not found."));
    expect(can).toHaveBeenCalledWith("resource.read", {
      type: "station",
      id: "s-hidden",
      createdBy: "u-other",
    });
    expect(can).not.toHaveBeenCalledWith("resource.write", expect.anything());
    expect(inner).not.toHaveBeenCalled();
  });

  it("#835 batch: a missing target outranks a readable-but-unwritable one", async () => {
    jest
      .spyOn(RbacObjectResolver, "resolveRow")
      .mockResolvedValueOnce(row("u-other"))
      .mockResolvedValueOnce(null);
    can.mockImplementation((action: unknown) => action === "resource.read");
    const inner = jest.fn();
    const tools: Record<string, GateableTool> = { e_update: tool(inner) };
    wrapWithPermissionGate(
      tools,
      set,
      ctx,
      authIs({
        verb: "write",
        resourceType: "entity",
        mode: "batch",
        itemsArg: "items",
        idField: "connectorEntityId",
      })
    );
    const r = await tools.e_update.execute!(
      {
        items: [{ connectorEntityId: "e-ro" }, { connectorEntityId: "e-gone" }],
      },
      {}
    );
    expect(r).toEqual(targetNotFound("Entity e-gone was not found."));
    expect(inner).not.toHaveBeenCalled();
  });

  it("#835: a resolver that throws stays the generic denial (fail-closed)", async () => {
    jest
      .spyOn(RbacObjectResolver, "resolveRow")
      .mockRejectedValue(new Error("db down"));
    const inner = jest.fn();
    const tools: Record<string, GateableTool> = { e_update: tool(inner) };
    wrapWithPermissionGate(
      tools,
      set,
      ctx,
      authIs({
        verb: "write",
        resourceType: "entity",
        mode: "batch",
        itemsArg: "items",
        idField: "connectorEntityId",
      })
    );
    const r = await tools.e_update.execute!(
      { items: [{ connectorEntityId: "e-1" }] },
      {}
    );
    expect(r).toEqual(
      permissionDenied("You don't have permission to write this entity.")
    );
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
        resourceType: "station",
        mode: "single",
        targetIdArg: "id",
      })
    );
    const r = await tools.fm_update.execute!({ id: "gone" }, {});
    // #835: absent (or another org's) is not found, named as sent.
    expect(r).toEqual(targetNotFound("Station gone was not found."));
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
        resourceType: "station",
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
    // Both are readable; only "a" is writable.
    can.mockImplementation(
      (action: unknown, object: unknown) =>
        action === "resource.read" || (object as { id: string }).id === "a"
    );
    const inner = jest.fn();
    const tools: Record<string, GateableTool> = { fm_update: tool(inner) };
    wrapWithPermissionGate(
      tools,
      set,
      ctx,
      authIs({
        verb: "write",
        resourceType: "station",
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
    // #835: names the permission and the target that failed it.
    expect(r).toHaveProperty(
      "error.message",
      "You don't have permission to write station b."
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
        resourceType: "station",
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

  // ── #829: objects and parts ─────────────────────────────────────────

  const partsByPath = authIs({
    verb: "write",
    resourceType: "entity",
    mode: "parts",
    objectPaths: ["items[].connectorEntityId"],
  });
  const partsById = authIs({
    verb: "write",
    resourceType: "entity",
    mode: "parts",
    partType: "field_mapping",
    itemsArg: "items",
    idField: "fieldMappingId",
  });

  it("parts: an unreadable entity answers TOOL_TARGET_NOT_FOUND and never runs", async () => {
    firstRefusal.mockResolvedValue({ id: "e-x", reason: "not_found" });
    const inner = jest.fn();
    const tools: Record<string, GateableTool> = { fm_create: tool(inner) };
    wrapWithPermissionGate(tools, set, ctx, partsByPath);
    const r = await tools.fm_create.execute!(
      { items: [{ connectorEntityId: "e-x" }] },
      {}
    );
    expect(r).toEqual(targetNotFound("Entity e-x was not found."));
    expect(inner).not.toHaveBeenCalled();
  });

  it("parts: a read-only entity answers TOOL_PERMISSION_DENIED naming it", async () => {
    firstRefusal.mockResolvedValue({ id: "e-sys", reason: "denied" });
    const inner = jest.fn();
    const tools: Record<string, GateableTool> = { fm_create: tool(inner) };
    wrapWithPermissionGate(tools, set, ctx, partsByPath);
    const r = await tools.fm_create.execute!(
      { items: [{ connectorEntityId: "e-sys" }] },
      {}
    );
    expect(r).toEqual(
      permissionDenied("You don't have permission to edit entity e-sys.")
    );
    expect(inner).not.toHaveBeenCalled();
  });

  it("parts: writable entities run, with no per-part or create-rule check", async () => {
    const inner = jest.fn(async () => "ok");
    const tools: Record<string, GateableTool> = { fm_create: tool(inner) };
    wrapWithPermissionGate(tools, set, ctx, partsByPath);
    expect(
      await tools.fm_create.execute!(
        {
          items: [{ connectorEntityId: "e-1" }, { connectorEntityId: "e-2" }],
        },
        {}
      )
    ).toBe("ok");
    expect(firstRefusal).toHaveBeenCalledWith(
      set,
      "org-1",
      "entity",
      ["e-1", "e-2"],
      "write"
    );
    expect(can).not.toHaveBeenCalled();
  });

  it("parts: no entity ids in the input is denied without a lookup", async () => {
    const inner = jest.fn();
    const tools: Record<string, GateableTool> = { fm_create: tool(inner) };
    wrapWithPermissionGate(tools, set, ctx, partsByPath);
    const r = await tools.fm_create.execute!({ items: [] }, {});
    expect(r).toHaveProperty("error.code", ApiCode.TOOL_PERMISSION_DENIED);
    expect(firstRefusal).not.toHaveBeenCalled();
    expect(inner).not.toHaveBeenCalled();
  });

  it("#832: an unreadable referenced column definition answers TOOL_TARGET_NOT_FOUND and never runs", async () => {
    firstRefusal.mockImplementation(async (_s, _o, type) =>
      type === "column_definition" ? { id: "cd-x", reason: "not_found" } : null
    );
    const inner = jest.fn();
    const tools: Record<string, GateableTool> = { fm_create: tool(inner) };
    wrapWithPermissionGate(
      tools,
      set,
      ctx,
      authIs({
        verb: "write",
        resourceType: "entity",
        mode: "parts",
        objectPaths: ["items[].connectorEntityId"],
        references: [
          {
            resourceType: "column_definition",
            paths: ["items[].columnDefinitionId"],
          },
        ],
      })
    );
    const r = await tools.fm_create.execute!(
      { items: [{ connectorEntityId: "e-1", columnDefinitionId: "cd-x" }] },
      {}
    );
    expect(r).toEqual(targetNotFound("Column definition cd-x was not found."));
    expect(firstRefusal).toHaveBeenCalledWith(
      set,
      "org-1",
      "column_definition",
      ["cd-x"],
      "read"
    );
    expect(inner).not.toHaveBeenCalled();
  });

  it("parts by id: the entity comes from the stored part, never from the input", async () => {
    const owner = jest
      .spyOn(RbacObjectResolver, "resolvePartOwner")
      .mockResolvedValue("e-stored");
    const tools: Record<string, GateableTool> = {
      fm_update: tool(async () => "ok"),
    };
    wrapWithPermissionGate(tools, set, ctx, partsById);
    expect(
      await tools.fm_update.execute!(
        {
          items: [{ fieldMappingId: "fm-1", connectorEntityId: "e-claimed" }],
        },
        {}
      )
    ).toBe("ok");
    expect(owner).toHaveBeenCalledWith("org-1", "field_mapping", "fm-1");
    expect(firstRefusal).toHaveBeenCalledWith(
      set,
      "org-1",
      "entity",
      ["e-stored"],
      "write"
    );
  });

  it("parts by id with counterparts: a mapping delete also checks its counterpart's entity", async () => {
    jest
      .spyOn(RbacObjectResolver, "resolvePartOwner")
      .mockResolvedValue("e-own");
    jest
      .spyOn(RbacObjectResolver, "resolveMappingCounterpartOwner")
      .mockResolvedValue("e-other");
    const tools: Record<string, GateableTool> = {
      fm_delete: tool(async () => "ok"),
    };
    wrapWithPermissionGate(
      tools,
      set,
      ctx,
      authIs({
        verb: "write",
        resourceType: "entity",
        mode: "parts",
        partType: "field_mapping",
        itemsArg: "items",
        idField: "fieldMappingId",
        counterparts: true,
      })
    );
    await tools.fm_delete.execute!({ items: [{ fieldMappingId: "fm-1" }] }, {});
    expect(firstRefusal).toHaveBeenCalledWith(
      set,
      "org-1",
      "entity",
      ["e-own", "e-other"],
      "write"
    );
  });

  it("parts by id: an unresolvable part denies the whole call", async () => {
    jest
      .spyOn(RbacObjectResolver, "resolvePartOwner")
      .mockResolvedValueOnce("e-1")
      .mockResolvedValueOnce(null);
    const inner = jest.fn();
    const tools: Record<string, GateableTool> = { fm_update: tool(inner) };
    wrapWithPermissionGate(tools, set, ctx, partsById);
    const r = await tools.fm_update.execute!(
      { items: [{ fieldMappingId: "fm-1" }, { fieldMappingId: "gone" }] },
      {}
    );
    // #835: absent (or another org's) is not found, named as sent.
    expect(r).toEqual(targetNotFound("Field mapping gone was not found."));
    expect(firstRefusal).not.toHaveBeenCalled();
    expect(inner).not.toHaveBeenCalled();
  });

  it("#835 parts by id: an unreadable owning entity is refused as the part, not naming the entity", async () => {
    jest
      .spyOn(RbacObjectResolver, "resolvePartOwner")
      .mockResolvedValue("e-hidden");
    firstRefusal.mockResolvedValue({ id: "e-hidden", reason: "not_found" });
    const inner = jest.fn();
    const tools: Record<string, GateableTool> = { fm_update: tool(inner) };
    wrapWithPermissionGate(tools, set, ctx, partsById);
    const r = await tools.fm_update.execute!(
      { items: [{ fieldMappingId: "fm-7" }] },
      {}
    );
    expect(r).toEqual(targetNotFound("Field mapping fm-7 was not found."));
    expect(JSON.stringify(r)).not.toContain("e-hidden");
    expect(inner).not.toHaveBeenCalled();
  });

  it("#835 parts by id: a readable, unwritable owning entity is denied naming the entity", async () => {
    jest
      .spyOn(RbacObjectResolver, "resolvePartOwner")
      .mockResolvedValue("e-ro");
    firstRefusal.mockResolvedValue({ id: "e-ro", reason: "denied" });
    const inner = jest.fn();
    const tools: Record<string, GateableTool> = { fm_update: tool(inner) };
    wrapWithPermissionGate(tools, set, ctx, partsById);
    const r = await tools.fm_update.execute!(
      { items: [{ fieldMappingId: "fm-7" }] },
      {}
    );
    expect(r).toEqual(
      permissionDenied("You don't have permission to edit entity e-ro.")
    );
    expect(inner).not.toHaveBeenCalled();
  });

  const transformAuth = authIs({
    verb: "write",
    resourceType: "entity",
    mode: "parts",
    objectPaths: ["expression.writes[].targetConnectorEntityId"],
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

  it("parts: an unreadable source answers not found before any write check", async () => {
    firstRefusal.mockImplementation(async (_s, _o, _t, _ids, verb) =>
      verb === "read" ? { id: "e-src", reason: "not_found" } : null
    );
    const inner = jest.fn();
    const tools: Record<string, GateableTool> = { transform: tool(inner) };
    wrapWithPermissionGate(tools, set, ctx, transformAuth);
    const r = await tools.transform.execute!(transformInput, {});
    expect(r).toHaveProperty("error.code", ApiCode.TOOL_TARGET_NOT_FOUND);
    expect(firstRefusal).toHaveBeenCalledTimes(1);
    expect(inner).not.toHaveBeenCalled();
  });

  it("parts: a readable source and writable targets run", async () => {
    const inner = jest.fn(async () => "queued");
    const tools: Record<string, GateableTool> = { transform: tool(inner) };
    wrapWithPermissionGate(tools, set, ctx, transformAuth);
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
  });

  it("entity create: a read-only connector is denied before the create rule", async () => {
    can.mockReturnValue(true);
    firstRefusal.mockResolvedValue({ id: "ci-sys", reason: "denied" });
    const inner = jest.fn();
    const tools: Record<string, GateableTool> = { ce_create: tool(inner) };
    wrapWithPermissionGate(
      tools,
      set,
      ctx,
      authIs({
        verb: "write",
        resourceType: "entity",
        mode: "create",
        containerPaths: ["items[].connectorInstanceId"],
      })
    );
    const r = await tools.ce_create.execute!(
      { items: [{ connectorInstanceId: "ci-sys" }] },
      {}
    );
    expect(r).toEqual(
      permissionDenied("You don't have permission to edit connector ci-sys.")
    );
    expect(firstRefusal).toHaveBeenCalledWith(
      set,
      "org-1",
      "connector_instance",
      ["ci-sys"],
      "write"
    );
    expect(inner).not.toHaveBeenCalled();
  });

  const entityBatch = (verb: "write" | "delete") =>
    authIs({
      verb,
      resourceType: "entity",
      mode: "batch",
      itemsArg: "items",
      idField: "connectorEntityId",
    });

  it("entity delete: needs write on the stored connector", async () => {
    jest
      .spyOn(RbacObjectResolver, "resolveRow")
      .mockResolvedValue(row("u-1", "ci-stored"));
    can.mockReturnValue(true);
    firstRefusal.mockResolvedValue({ id: "ci-stored", reason: "denied" });
    const inner = jest.fn();
    const tools: Record<string, GateableTool> = { ce_delete: tool(inner) };
    wrapWithPermissionGate(tools, set, ctx, entityBatch("delete"));
    const r = await tools.ce_delete.execute!(
      {
        items: [
          { connectorEntityId: "e-1", connectorInstanceId: "ci-claimed" },
        ],
      },
      {}
    );
    expect(r).toHaveProperty("error.code", ApiCode.TOOL_PERMISSION_DENIED);
    expect(firstRefusal).toHaveBeenCalledWith(
      set,
      "org-1",
      "connector_instance",
      ["ci-stored"],
      "write"
    );
    expect(inner).not.toHaveBeenCalled();
  });

  it("entity update: needs only the entity's own write, not the connector's", async () => {
    jest
      .spyOn(RbacObjectResolver, "resolveRow")
      .mockResolvedValue(row("u-1", "ci-sys"));
    can.mockReturnValue(true);
    firstRefusal.mockResolvedValue({ id: "ci-sys", reason: "denied" });
    const tools: Record<string, GateableTool> = {
      ce_update: tool(async () => "ok"),
    };
    wrapWithPermissionGate(tools, set, ctx, entityBatch("write"));
    expect(
      await tools.ce_update.execute!(
        { items: [{ connectorEntityId: "e-1" }] },
        {}
      )
    ).toBe("ok");
    expect(firstRefusal).not.toHaveBeenCalled();
  });

  it("fail-closed: an owner lookup error denies", async () => {
    firstRefusal.mockRejectedValue(new Error("db down"));
    const inner = jest.fn();
    const tools: Record<string, GateableTool> = { fm_create: tool(inner) };
    wrapWithPermissionGate(tools, set, ctx, partsByPath);
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
