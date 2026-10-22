import { jest, describe, it, expect, beforeEach } from "@jest/globals";
import { asSchema } from "ai";

import { ApiError } from "../../../services/http.service.js";
import { ApiCode } from "../../../constants/api-codes.constants.js";
import type { PermissionContext } from "../../../services/permission.service.js";

/**
 * Unit coverage for the view_management tools (#645). Each tool is a thin
 * wrapper over CuratedViewService / GrantService; these tests pin the result
 * shapes the agent relies on: a 403 propagates (the permission gate turns it
 * into TOOL_PERMISSION_DENIED), a 404 is TOOL_TARGET_NOT_FOUND, any other
 * refusal keeps its own code, and an unexpected failure never leaks its text.
 */

const list = jest.fn<(...args: unknown[]) => Promise<unknown>>();
const listEntities = jest.fn<(...args: unknown[]) => Promise<unknown>>();
const get = jest.fn<(...args: unknown[]) => Promise<unknown>>();
const create = jest.fn<(...args: unknown[]) => Promise<unknown>>();
const update = jest.fn<(...args: unknown[]) => Promise<unknown>>();
const del = jest.fn<(...args: unknown[]) => Promise<unknown>>();
jest.unstable_mockModule("../../../services/curated-view.service.js", () => ({
  CuratedViewService: { list, listEntities, get, create, update, delete: del },
}));

const grantShare = jest.fn<(...args: unknown[]) => Promise<unknown>>();
const grantList = jest.fn<(...args: unknown[]) => Promise<unknown>>();
const grantRevoke = jest.fn<(...args: unknown[]) => Promise<unknown>>();
jest.unstable_mockModule("../../../services/grant.service.js", () => ({
  GrantService: {
    share: grantShare,
    list: grantList,
    revoke: grantRevoke,
    granteePrincipal: (orgId: string, g: { type: string; userId?: string }) =>
      g.type === "team"
        ? { principalType: "role", principalId: `sysrole:${orgId}:member` }
        : { principalType: "user", principalId: g.userId },
  },
}));

const { runViewTool } =
  await import("../../../tools/curated-views/curated-view-tool.util.js");
const { CuratedViewListTool } =
  await import("../../../tools/curated-views/curated-view-list.tool.js");
const { CuratedViewEntityListTool } =
  await import("../../../tools/curated-views/curated-view-entity-list.tool.js");
const { CuratedViewGetTool } =
  await import("../../../tools/curated-views/curated-view-get.tool.js");
const { CuratedViewCreateTool } =
  await import("../../../tools/curated-views/curated-view-create.tool.js");
const { CuratedViewUpdateTool } =
  await import("../../../tools/curated-views/curated-view-update.tool.js");
const { CuratedViewDeleteTool } =
  await import("../../../tools/curated-views/curated-view-delete.tool.js");
const { CuratedViewShareTool } =
  await import("../../../tools/curated-views/curated-view-share.tool.js");

const ctx: PermissionContext = {
  userId: "u-1",
  organizationId: "org-1",
  roles: ["owner"],
};

type Executable = { execute: (i: unknown, o: unknown) => Promise<unknown> };
const exec = (built: unknown, input: unknown) =>
  (built as Executable).execute(input, { toolCallId: "t", messages: [] });

const FILTER = {
  combinator: "and",
  conditions: [{ field: "region", operator: "eq", value: "NE" }],
};

describe("runViewTool (#645)", () => {
  const failed = ApiCode.CURATED_VIEW_CREATE_FAILED;

  it("re-throws a 403 for the permission gate", async () => {
    const err = new ApiError(403, ApiCode.PERMISSION_DENIED, "nope");
    await expect(runViewTool(failed, () => Promise.reject(err))).rejects.toBe(
      err
    );
  });

  it("keeps a plan refusal's own code instead of re-throwing it", async () => {
    const r = await runViewTool(failed, () =>
      Promise.reject(
        new ApiError(
          403,
          ApiCode.CURATED_VIEW_FILTER_SQL_NOT_ENTITLED,
          "Your plan doesn't include advanced view filters"
        )
      )
    );
    expect(r).toEqual({
      error: {
        code: ApiCode.CURATED_VIEW_FILTER_SQL_NOT_ENTITLED,
        message: "Your plan doesn't include advanced view filters",
      },
    });
  });

  it("re-throws a boundary refusal, which is about permissions", async () => {
    const err = new ApiError(403, ApiCode.RBAC_GRANT_EXCEEDS_BOUNDARY, "no");
    await expect(runViewTool(failed, () => Promise.reject(err))).rejects.toBe(
      err
    );
  });

  it("turns a 404 into TOOL_TARGET_NOT_FOUND", async () => {
    const r = await runViewTool(failed, () =>
      Promise.reject(
        new ApiError(
          404,
          ApiCode.CURATED_VIEW_NOT_FOUND,
          "Curated view not found"
        )
      )
    );
    expect(r).toEqual({
      error: {
        code: ApiCode.TOOL_TARGET_NOT_FOUND,
        message: "Curated view not found",
      },
    });
  });

  it("keeps another 4xx's own code and message", async () => {
    const r = await runViewTool(failed, () =>
      Promise.reject(
        new ApiError(409, ApiCode.CURATED_VIEW_DUPLICATE_KEY, "Duplicate key")
      )
    );
    expect(r).toEqual({
      error: {
        code: ApiCode.CURATED_VIEW_DUPLICATE_KEY,
        message: "Duplicate key",
      },
    });
  });

  it("hides a 5xx's message behind the failed code", async () => {
    const r = await runViewTool(failed, () =>
      Promise.reject(
        new ApiError(500, ApiCode.CURATED_VIEW_CREATE_FAILED, "pg: secret")
      )
    );
    expect(r).toEqual({
      error: { code: failed, message: "The curated view operation failed." },
    });
  });

  it("hides an unexpected error's message behind the failed code", async () => {
    const r = await runViewTool(failed, () =>
      Promise.reject(new Error("connection reset: host=db-internal"))
    );
    expect(JSON.stringify(r)).not.toContain("db-internal");
    expect(r).toEqual({
      error: { code: failed, message: "The curated view operation failed." },
    });
  });
});

describe("view_management tools (#645)", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("curated_view_list sorts by label and defaults the page", async () => {
    list.mockResolvedValue({
      curatedViews: [],
      total: 0,
      limit: 25,
      offset: 0,
    });
    await exec(new CuratedViewListTool().build(ctx), { search: "NE" });
    expect(list).toHaveBeenCalledWith(
      ctx,
      expect.objectContaining({
        search: "NE",
        sortBy: "label",
        sortOrder: "asc",
        limit: 25,
        offset: 0,
      })
    );
  });

  it("curated_view_entity_list searches and defaults the page", async () => {
    listEntities.mockResolvedValue({
      entities: [],
      total: 0,
      limit: 25,
      offset: 0,
    });
    await exec(new CuratedViewEntityListTool().build(ctx), {
      search: "cust",
    });
    expect(listEntities).toHaveBeenCalledWith(ctx, {
      search: "cust",
      limit: 25,
      offset: 0,
    });
  });

  it("curated_view_get adds grants only for a caller who can share", async () => {
    get.mockResolvedValue({ id: "cv-1", capabilities: { share: false } });
    const reader = await exec(new CuratedViewGetTool().build(ctx), {
      curatedViewId: "cv-1",
    });
    expect(reader).toEqual({
      curatedView: { id: "cv-1", capabilities: { share: false } },
    });
    expect(grantList).not.toHaveBeenCalled();

    get.mockResolvedValue({ id: "cv-1", capabilities: { share: true } });
    grantList.mockResolvedValue([{ id: "g-1" }]);
    const sharer = await exec(new CuratedViewGetTool().build(ctx), {
      curatedViewId: "cv-1",
    });
    expect(grantList).toHaveBeenCalledWith(ctx, "curated_view", "cv-1");
    expect(sharer).toMatchObject({ grants: [{ id: "g-1" }] });
  });

  it("curated_view_create passes columns as keys and the session as provenance", async () => {
    create.mockResolvedValue({ id: "cv-9" });
    const r = await exec(new CuratedViewCreateTool().build(ctx, "portal-1"), {
      connectorEntityId: "ent-1",
      key: "ne_accounts",
      label: "NE accounts",
      filter: FILTER,
      columns: ["name", "region"],
    });
    expect(create).toHaveBeenCalledWith(
      ctx,
      {
        connectorEntityId: "ent-1",
        key: "ne_accounts",
        label: "NE accounts",
        filter: FILTER,
        columnKeys: ["name", "region"],
      },
      { sourcePortalId: "portal-1" }
    );
    expect(r).toEqual({ success: true, curatedView: { id: "cv-9" } });
  });

  it("curated_view_create refuses both filter modes at once", async () => {
    const r = await exec(new CuratedViewCreateTool().build(ctx, null), {
      connectorEntityId: "ent-1",
      key: "k",
      label: "L",
      filter: FILTER,
      filterSql: "region = 'NE'",
    });
    expect(r).toEqual({
      error: {
        code: ApiCode.CURATED_VIEW_INVALID_PAYLOAD,
        message: "Use either the builder filter or a SQL filter, not both",
      },
    });
    expect(create).not.toHaveBeenCalled();
  });

  it("curated_view_create refuses a reserved key", async () => {
    const r = await exec(new CuratedViewCreateTool().build(ctx, null), {
      connectorEntityId: "ent-1",
      key: "_meta_columns",
      label: "L",
    });
    expect(r).toMatchObject({
      error: { code: ApiCode.CURATED_VIEW_INVALID_PAYLOAD },
    });
    expect(create).not.toHaveBeenCalled();
  });

  it("curated_view_create refuses an unknown input key", () => {
    const parsed = new CuratedViewCreateTool().schema.safeParse({
      connectorEntityId: "ent-1",
      key: "k",
      label: "L",
      fieldMappingIds: ["fm-1"],
    });
    expect(parsed.success).toBe(false);
  });

  it("curated_view_update needs a change, and passes columns as keys", async () => {
    const refused = await exec(new CuratedViewUpdateTool().build(ctx), {
      curatedViewId: "cv-1",
    });
    expect(refused).toEqual({
      error: {
        code: ApiCode.CURATED_VIEW_INVALID_PAYLOAD,
        message: "Give at least one field to change",
      },
    });
    expect(update).not.toHaveBeenCalled();

    update.mockResolvedValue({ id: "cv-1" });
    await exec(new CuratedViewUpdateTool().build(ctx), {
      curatedViewId: "cv-1",
      columns: ["region"],
    });
    expect(update).toHaveBeenCalledWith(ctx, "cv-1", {
      columnKeys: ["region"],
    });
  });

  it("curated_view_delete returns the cascade", async () => {
    del.mockResolvedValue({
      id: "cv-1",
      cascaded: { fieldMappings: 2, stationViews: 1, grants: 3 },
    });
    const r = await exec(new CuratedViewDeleteTool().build(ctx), {
      curatedViewId: "cv-1",
    });
    expect(r).toEqual({
      success: true,
      id: "cv-1",
      cascaded: { fieldMappings: 2, stationViews: 1, grants: 3 },
    });
  });

  it("curated_view_share grants with the agent audit stamp", async () => {
    grantShare.mockResolvedValue({ id: "g-1", access: "read" });
    const r = await exec(new CuratedViewShareTool().build(ctx), {
      curatedViewId: "cv-1",
      grantee: { type: "team" },
      access: "read",
    });
    expect(grantShare).toHaveBeenCalledWith(
      ctx,
      {
        resourceType: "curated_view",
        resourceId: "cv-1",
        grantee: { type: "team" },
        access: "read",
      },
      { sourceIp: null, userAgent: "portal-agent" }
    );
    expect(r).toEqual({ success: true, grant: { id: "g-1", access: "read" } });
  });

  it('curated_view_share "none" revokes the grantee\'s share', async () => {
    grantList.mockResolvedValue([
      {
        id: "g-team",
        principalType: "role",
        principalId: "sysrole:org-1:member",
      },
      { id: "g-jane", principalType: "user", principalId: "jane" },
    ]);
    grantRevoke.mockResolvedValue({ id: "g-jane" });
    const r = await exec(new CuratedViewShareTool().build(ctx), {
      curatedViewId: "cv-1",
      grantee: { type: "user", userId: "jane" },
      access: "none",
    });
    expect(grantRevoke).toHaveBeenCalledWith(ctx, "g-jane", {
      sourceIp: null,
      userAgent: "portal-agent",
    });
    expect(r).toEqual({ success: true, revoked: true });
  });

  it('curated_view_share "none" with no share revokes nothing', async () => {
    grantList.mockResolvedValue([]);
    const r = await exec(new CuratedViewShareTool().build(ctx), {
      curatedViewId: "cv-1",
      grantee: { type: "team" },
      access: "none",
    });
    expect(grantRevoke).not.toHaveBeenCalled();
    expect(r).toEqual({ success: true, revoked: false });
  });

  it("curated_view_share refuses a grantee named by email", () => {
    const parsed = new CuratedViewShareTool().schema.safeParse({
      curatedViewId: "cv-1",
      grantee: { type: "user", email: "jane@example.com" },
      access: "read",
    });
    expect(parsed.success).toBe(false);
  });

  it("a service 403 propagates out of the tool", async () => {
    update.mockRejectedValue(
      new ApiError(403, ApiCode.PERMISSION_DENIED, "You don't have permission")
    );
    await expect(
      exec(new CuratedViewUpdateTool().build(ctx), {
        curatedViewId: "cv-1",
        label: "x",
      })
    ).rejects.toMatchObject({ status: 403 });
  });
});

/**
 * The AI SDK checks tool input with its own zod copy before `execute` runs. A
 * refine failing there left the schema on the issue, and with the recursive
 * FilterExpressionSchema inside, reading the error's message threw "Converting
 * circular structure to JSON" (found in the #645 smoke walk). The model-facing
 * schemas carry no refines, so every SDK refusal must stay printable.
 */
describe("view tool input refusals through the AI SDK (#645)", () => {
  const sdkError = async (schema: unknown, input: unknown) => {
    const result = await asSchema(schema as never).validate!(input);
    expect(result.success).toBe(false);
    return (result as { error: Error }).error;
  };

  it.each([
    [
      "create, a missing label",
      CuratedViewCreateTool,
      { connectorEntityId: "e", key: "k" },
    ],
    [
      "create, an unknown field",
      CuratedViewCreateTool,
      { connectorEntityId: "e", key: "k", label: "L", extra: 1 },
    ],
    [
      "create, a key too long",
      CuratedViewCreateTool,
      { connectorEntityId: "e", key: "k".repeat(64), label: "L" },
    ],
    [
      "create, a bad filter operator",
      CuratedViewCreateTool,
      {
        connectorEntityId: "e",
        key: "k",
        label: "L",
        filter: {
          combinator: "and",
          conditions: [{ field: "r", operator: "nope", value: 1 }],
        },
      },
    ],
    [
      "update, a label too long",
      CuratedViewUpdateTool,
      { curatedViewId: "v", label: "x".repeat(121) },
    ],
  ])("%s has a printable message", async (_name, ToolClass, input) => {
    const err = await sdkError(new ToolClass().schema, input);
    expect(() => err.message).not.toThrow();
  });

  it.each([
    [
      "create, both filter modes",
      CuratedViewCreateTool,
      {
        connectorEntityId: "e",
        key: "k",
        label: "L",
        filter: FILTER,
        filterSql: "x",
      },
    ],
    [
      "create, a reserved key",
      CuratedViewCreateTool,
      { connectorEntityId: "e", key: "_meta_x", label: "L" },
    ],
    ["update, no change", CuratedViewUpdateTool, { curatedViewId: "v" }],
    [
      "update, both filter modes",
      CuratedViewUpdateTool,
      { curatedViewId: "v", filter: FILTER, filterSql: "x" },
    ],
  ])(
    "%s passes the SDK and is refused in execute",
    async (_name, ToolClass, input) => {
      const result = await asSchema(new ToolClass().schema as never).validate!(
        input
      );
      expect(result.success).toBe(true);
    }
  );
});
