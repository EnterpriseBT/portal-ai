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

const attachViews = jest.fn<(...args: unknown[]) => Promise<unknown>>();
const detachViews = jest.fn<(...args: unknown[]) => Promise<unknown>>();
const listViewsForStations =
  jest.fn<(...args: unknown[]) => Promise<Map<string, unknown[]>>>();
jest.unstable_mockModule(
  "../../../services/station-attachment.service.js",
  () => ({
    StationAttachmentService: {
      attachViews,
      detachViews,
      listViewsForStations,
    },
  })
);

const listForCaller = jest.fn<(...args: unknown[]) => Promise<unknown>>();
jest.unstable_mockModule("../../../services/station-query.service.js", () => ({
  StationQueryService: { listForCaller },
}));

const forgetSessionViews = jest.fn<(...args: unknown[]) => void>();
const resolveGrantedViewColumns =
  jest.fn<(...args: unknown[]) => Promise<unknown>>();
jest.unstable_mockModule("../../../services/portal-sql.service.js", () => ({
  PortalSqlService: { forgetSessionViews, resolveGrantedViewColumns },
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
const { CuratedViewAttachTool } =
  await import("../../../tools/curated-views/curated-view-attach.tool.js");
const { CuratedViewDetachTool } =
  await import("../../../tools/curated-views/curated-view-detach.tool.js");
const { StationListTool } =
  await import("../../../tools/curated-views/station-list.tool.js");

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

  it("answers an unattachable view as TOOL_TARGET_NOT_FOUND, not a permission refusal (#1036)", async () => {
    const r = await runViewTool(failed, () =>
      Promise.reject(
        new ApiError(
          403,
          ApiCode.STATION_ATTACHMENT_NOT_READABLE,
          "One or more items can't be attached"
        )
      )
    );
    expect(r).toEqual({
      error: {
        code: ApiCode.TOOL_TARGET_NOT_FOUND,
        message: "One or more items can't be attached",
      },
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
 * The AI SDK checks tool input against the tool's schema before `execute`
 * runs. While it resolved a second zod copy, a failed refine left the schema
 * on the issue, and with the recursive FilterExpressionSchema inside, reading
 * the error's message threw "Converting circular structure to JSON" (found in
 * the #645 smoke walk; #645 moved the refines into `execute` to dodge it).
 * #846 gave the SDK the app's zod, so the refines are back on the schema the
 * model sees and every SDK refusal must stay printable, with the reason.
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
      "not both",
    ],
    [
      "create, a reserved key",
      CuratedViewCreateTool,
      { connectorEntityId: "e", key: "_meta_x", label: "L" },
      "Reserved key",
    ],
    [
      "update, no change",
      CuratedViewUpdateTool,
      { curatedViewId: "v" },
      "Give at least one field to change",
    ],
    [
      "update, both filter modes",
      CuratedViewUpdateTool,
      { curatedViewId: "v", filter: FILTER, filterSql: "x" },
      "not both",
    ],
  ])(
    "%s is refused by the SDK with the refine's reason, not a schema dump",
    async (_name, ToolClass, input, reason) => {
      const err = await sdkError(new ToolClass().schema, input);
      expect(() => err.message).not.toThrow();
      expect(err.message).toContain(reason);
      expect(err.message).not.toContain('"schema"');
    }
  );
});

describe("curated_view_attach / curated_view_detach (#1036)", () => {
  const SESSION = { stationId: "st-session", portalId: "portal-1" };
  const AUDIT = {
    userId: "u-1",
    organizationId: "org-1",
    sourceIp: null,
    userAgent: "portal-agent",
    sourcePortalId: "portal-1",
  };
  const SET = { set: true };
  const view = (id: string, key: string) => ({
    view: { id, key, label: "NE" },
    columns: [
      { normalizedKey: "name", pgType: "text", columnName: "c_name" },
      { normalizedKey: "amount", pgType: "numeric", columnName: "c_amount" },
    ],
  });

  beforeEach(() => {
    jest.clearAllMocks();
    resolveGrantedViewColumns.mockResolvedValue({
      set: SET,
      views: [view("v1", "ne_accounts"), view("v-other", "other_view")],
    });
  });

  it("attaches to the session's station by default and makes it queryable this turn", async () => {
    attachViews.mockResolvedValue({
      stationId: "st-session",
      added: ["v1"],
      alreadyAttached: [],
    });
    const r = await exec(new CuratedViewAttachTool().build(ctx, SESSION), {
      curatedViewIds: ["v1"],
    });
    expect(attachViews).toHaveBeenCalledWith(
      ctx,
      { stationId: "st-session", curatedViewIds: ["v1"] },
      AUDIT
    );
    expect(forgetSessionViews).toHaveBeenCalledWith(
      "st-session",
      "org-1",
      "u-1"
    );
    expect(resolveGrantedViewColumns).toHaveBeenCalledWith(
      "st-session",
      "org-1",
      "u-1"
    );
    expect(r).toEqual({
      success: true,
      stationId: "st-session",
      isSessionStation: true,
      added: ["v1"],
      alreadyAttached: [],
      views: [
        {
          id: "v1",
          key: "ne_accounts",
          label: "NE",
          columns: [
            { key: "name", wideColumnName: "c_name", type: "text" },
            { key: "amount", wideColumnName: "c_amount", type: "numeric" },
          ],
        },
      ],
    });
  });

  it("still forgets and reports a view someone else attached earlier this turn", async () => {
    // The view came back "already attached", but this turn may have cached
    // the station's views before that attach: the report reads fresh, so
    // sql_query must too.
    attachViews.mockResolvedValue({
      stationId: "st-session",
      added: [],
      alreadyAttached: ["v1"],
    });
    const r = (await exec(new CuratedViewAttachTool().build(ctx, SESSION), {
      curatedViewIds: ["v1"],
    })) as { views: { id: string }[] };
    expect(forgetSessionViews).toHaveBeenCalledWith(
      "st-session",
      "org-1",
      "u-1"
    );
    expect(r.views.map((v) => v.id)).toEqual(["v1"]);
  });

  it("reports only the requested views, from one resolution", async () => {
    attachViews.mockResolvedValue({
      stationId: "st-session",
      added: ["v1"],
      alreadyAttached: [],
    });
    const r = (await exec(new CuratedViewAttachTool().build(ctx, SESSION), {
      curatedViewIds: ["v1"],
    })) as { views: { id: string }[] };
    expect(r.views.map((v) => v.id)).toEqual(["v1"]);
    expect(resolveGrantedViewColumns).toHaveBeenCalledTimes(1);
    expect(listViewsForStations).not.toHaveBeenCalled();
  });

  it("attaching to another station neither forgets the session's views nor reports columns", async () => {
    attachViews.mockResolvedValue({
      stationId: "st-other",
      added: ["v1"],
      alreadyAttached: [],
    });
    const r = await exec(new CuratedViewAttachTool().build(ctx, SESSION), {
      curatedViewIds: ["v1"],
      stationId: "st-other",
    });
    expect(forgetSessionViews).not.toHaveBeenCalled();
    expect(resolveGrantedViewColumns).not.toHaveBeenCalled();
    expect(r).toEqual({
      success: true,
      stationId: "st-other",
      isSessionStation: false,
      added: ["v1"],
      alreadyAttached: [],
    });
  });

  it("detaches from the session's station and forgets its views when something was removed", async () => {
    detachViews.mockResolvedValue({
      stationId: "st-session",
      removed: ["v1"],
      notAttached: ["v9"],
    });
    const r = await exec(new CuratedViewDetachTool().build(ctx, SESSION), {
      curatedViewIds: ["v1", "v9"],
    });
    expect(detachViews).toHaveBeenCalledWith(
      ctx,
      { stationId: "st-session", curatedViewIds: ["v1", "v9"] },
      AUDIT
    );
    expect(forgetSessionViews).toHaveBeenCalledWith(
      "st-session",
      "org-1",
      "u-1"
    );
    expect(r).toEqual({
      success: true,
      stationId: "st-session",
      isSessionStation: true,
      removed: ["v1"],
      notAttached: ["v9"],
    });
  });

  it("detaching nothing doesn't forget the session's views", async () => {
    detachViews.mockResolvedValue({
      stationId: "st-session",
      removed: [],
      notAttached: ["v1"],
    });
    await exec(new CuratedViewDetachTool().build(ctx, SESSION), {
      curatedViewIds: ["v1"],
    });
    expect(forgetSessionViews).not.toHaveBeenCalled();
  });

  it("re-throws a permission 403 for the gate", async () => {
    attachViews.mockRejectedValue(
      new ApiError(403, ApiCode.PERMISSION_DENIED, "no write")
    );
    await expect(
      exec(new CuratedViewAttachTool().build(ctx, SESSION), {
        curatedViewIds: ["v1"],
      })
    ).rejects.toMatchObject({ status: 403 });
  });

  it("answers an unreadable station as TOOL_TARGET_NOT_FOUND", async () => {
    detachViews.mockRejectedValue(
      new ApiError(404, ApiCode.STATION_NOT_FOUND, "Station not found")
    );
    expect(
      await exec(new CuratedViewDetachTool().build(ctx, SESSION), {
        curatedViewIds: ["v1"],
      })
    ).toEqual({
      error: {
        code: ApiCode.TOOL_TARGET_NOT_FOUND,
        message: "Station not found",
      },
    });
  });

  it("hides an unexpected failure behind its own failed code", async () => {
    attachViews.mockRejectedValue(new Error("db-internal"));
    expect(
      await exec(new CuratedViewAttachTool().build(ctx, SESSION), {
        curatedViewIds: ["v1"],
      })
    ).toEqual({
      error: {
        code: ApiCode.CURATED_VIEW_ATTACH_FAILED,
        message: "The curated view operation failed.",
      },
    });
  });

  it.each([
    ["attach", () => new CuratedViewAttachTool()],
    ["detach", () => new CuratedViewDetachTool()],
  ])(
    "%s refuses an empty batch, more than 25 views, and unknown keys",
    (_n, make) => {
      const schema = make().schema;
      expect(schema.safeParse({ curatedViewIds: [] }).success).toBe(false);
      expect(
        schema.safeParse({
          curatedViewIds: Array.from({ length: 26 }, (_, i) => `v${i}`),
        }).success
      ).toBe(false);
      expect(
        schema.safeParse({ curatedViewIds: ["v1"], extra: 1 }).success
      ).toBe(false);
      expect(
        schema.safeParse({
          curatedViewIds: Array.from({ length: 25 }, (_, i) => `v${i}`),
        }).success
      ).toBe(true);
    }
  );
});

describe("station_list (#1036)", () => {
  const SESSION = { stationId: "st-session", portalId: "portal-1" };
  const SET = { set: true };
  const row = (id: string, name: string, write: boolean) => ({
    id,
    name,
    description: `${name} description`,
    organizationId: "org-1",
    createdBy: "u-1",
    enabledToolpacks: ["data_query", "org:tp-1"],
    capabilities: { read: true, write, delete: write, share: write },
  });

  beforeEach(() => {
    jest.clearAllMocks();
    listForCaller.mockResolvedValue({
      set: SET,
      stations: [
        row("st-session", "Playground", true),
        row("st-2", "Sales", false),
      ],
      total: 2,
    });
    listViewsForStations.mockResolvedValue(
      new Map([
        [
          "st-session",
          [
            { id: "v1", key: "ne_accounts", label: "NE", canRead: true },
            { canRead: false, label: null },
          ],
        ],
        ["st-2", []],
      ])
    );
  });

  it("lists readable stations by name with packs, capabilities and attached views", async () => {
    const r = await exec(new StationListTool().build(ctx, SESSION), {
      search: "a",
    });
    expect(listForCaller).toHaveBeenCalledWith(ctx, {
      search: "a",
      limit: 25,
      offset: 0,
      sortBy: "name",
      sortOrder: "asc",
    });
    expect(listViewsForStations).toHaveBeenCalledWith(SET, "org-1", [
      "st-session",
      "st-2",
    ]);
    expect(r).toEqual({
      stations: [
        {
          id: "st-session",
          name: "Playground",
          description: "Playground description",
          isSessionStation: true,
          capabilities: { read: true, write: true, delete: true, share: true },
          toolpacks: ["data_query", "org:tp-1"],
          views: [
            { id: "v1", key: "ne_accounts", label: "NE" },
            { unreadable: true },
          ],
        },
        {
          id: "st-2",
          name: "Sales",
          description: "Sales description",
          isSessionStation: false,
          capabilities: {
            read: true,
            write: false,
            delete: false,
            share: false,
          },
          toolpacks: ["data_query", "org:tp-1"],
          views: [],
        },
      ],
      total: 2,
      limit: 25,
      offset: 0,
    });
  });

  it("pages up to 100 and refuses more, or unknown keys", () => {
    const schema = new StationListTool().schema;
    expect(schema.safeParse({ limit: 100, offset: 50 }).success).toBe(true);
    expect(schema.safeParse({ limit: 101 }).success).toBe(false);
    expect(schema.safeParse({ limit: 0 }).success).toBe(false);
    expect(schema.safeParse({ stationId: "x" }).success).toBe(false);
  });

  it("hides an unexpected failure behind STATION_LIST_FAILED", async () => {
    listForCaller.mockRejectedValue(new Error("db-internal"));
    expect(await exec(new StationListTool().build(ctx, SESSION), {})).toEqual({
      error: {
        code: ApiCode.STATION_LIST_FAILED,
        message: "The curated view operation failed.",
      },
    });
  });
});
