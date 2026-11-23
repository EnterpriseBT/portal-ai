import { jest, describe, it, expect, beforeEach } from "@jest/globals";
import { ZodError } from "zod";

import { ApiError } from "../../../services/http.service.js";
import { ApiCode } from "../../../constants/api-codes.constants.js";
import type { PermissionContext } from "../../../services/permission.service.js";

/**
 * Unit coverage for the tag_management catalog tools (#1071). Each tool is a
 * thin wrapper over EntityTagService (or TagAssignmentService for one
 * object's tags); these tests pin what the agent relies on: a 403 propagates
 * (the permission gate turns it into TOOL_PERMISSION_DENIED), a 404 is
 * TOOL_TARGET_NOT_FOUND, any other refusal keeps its own code, and an
 * unexpected failure never leaks its text.
 */

const list = jest.fn<(...args: unknown[]) => Promise<unknown>>();
const create = jest.fn<(...args: unknown[]) => Promise<unknown>>();
const update = jest.fn<(...args: unknown[]) => Promise<unknown>>();
const del = jest.fn<(...args: unknown[]) => Promise<unknown>>();
jest.unstable_mockModule("../../../services/entity-tag.service.js", () => ({
  EntityTagService: { list, create, update, delete: del },
}));

const listOnTarget = jest.fn<(...args: unknown[]) => Promise<unknown>>();
jest.unstable_mockModule("../../../services/tag-assignment.service.js", () => ({
  TagAssignmentService: { list: listOnTarget },
}));

const { runTagTool } = await import("../../../tools/tags/tag-tool.util.js");
const { TagListTool } = await import("../../../tools/tags/tag-list.tool.js");
const { TagCreateTool } =
  await import("../../../tools/tags/tag-create.tool.js");
const { TagUpdateTool } =
  await import("../../../tools/tags/tag-update.tool.js");
const { TagDeleteTool } =
  await import("../../../tools/tags/tag-delete.tool.js");

const ctx: PermissionContext = {
  userId: "u-1",
  organizationId: "org-1",
  roles: ["owner"],
};

type Executable = { execute: (i: unknown, o: unknown) => Promise<unknown> };
const exec = (built: unknown, input: unknown) =>
  (built as Executable).execute(input, { toolCallId: "t", messages: [] });

const TAG = {
  id: "tag-1",
  organizationId: "org-1",
  name: "Finance",
  color: "#2563EB",
  description: null,
  sourcePortalId: null,
  created: 1,
  createdBy: "u-1",
  updated: null,
  updatedBy: null,
  deleted: null,
  deletedBy: null,
};

beforeEach(() => {
  for (const fn of [list, create, update, del, listOnTarget]) fn.mockReset();
});

describe("runTagTool (#1071)", () => {
  const failed = ApiCode.ENTITY_TAG_CREATE_FAILED;

  it("re-throws a 403 for the permission gate", async () => {
    const err = new ApiError(403, ApiCode.PERMISSION_DENIED, "nope");
    await expect(runTagTool(failed, () => Promise.reject(err))).rejects.toBe(
      err
    );
  });

  it("turns a 404 into TOOL_TARGET_NOT_FOUND", async () => {
    const r = await runTagTool(failed, () =>
      Promise.reject(
        new ApiError(404, ApiCode.ENTITY_TAG_NOT_FOUND, "Entity tag not found")
      )
    );
    expect(r).toEqual({
      error: {
        code: ApiCode.TOOL_TARGET_NOT_FOUND,
        message: "Entity tag not found",
      },
    });
  });

  it("keeps another refusal's own code", async () => {
    const r = await runTagTool(failed, () =>
      Promise.reject(
        new ApiError(409, ApiCode.ENTITY_TAG_DUPLICATE_NAME, "Taken")
      )
    );
    expect(r).toEqual({
      error: { code: ApiCode.ENTITY_TAG_DUPLICATE_NAME, message: "Taken" },
    });
  });

  it("hides an unexpected failure's text behind failedCode", async () => {
    const r = await runTagTool(failed, () =>
      Promise.reject(new Error("connection reset by 10.0.0.4"))
    );
    expect(r).toEqual({
      error: { code: failed, message: "The tag operation failed." },
    });
  });

  it("hides a 500's text too", async () => {
    const r = await runTagTool(failed, () =>
      Promise.reject(new ApiError(500, failed, "duplicate key value ..."))
    );
    expect(r).toEqual({
      error: { code: failed, message: "The tag operation failed." },
    });
  });

  it("types refused input as ENTITY_TAG_INVALID_PAYLOAD", async () => {
    const r = await runTagTool(failed, () =>
      Promise.reject(
        new ZodError([
          { code: "custom", path: ["name"], message: "Name is required" },
        ])
      )
    );
    expect(r).toEqual({
      error: {
        code: ApiCode.ENTITY_TAG_INVALID_PAYLOAD,
        message: "Name is required",
      },
    });
  });
});

describe("tag_list", () => {
  it("lists readable tags sorted by name, with a default page", async () => {
    list.mockResolvedValue({
      entityTags: [{ ...TAG, capabilities: { read: true } }],
      total: 1,
    });
    const r = await exec(new TagListTool().build(ctx), { search: "fin" });

    expect(list).toHaveBeenCalledWith(ctx, {
      search: "fin",
      limit: 25,
      offset: 0,
      sortBy: "name",
      sortOrder: "asc",
    });
    expect(r).toEqual({
      tags: [
        {
          id: "tag-1",
          name: "Finance",
          color: "#2563EB",
          description: null,
          sourcePortalId: null,
        },
      ],
      total: 1,
    });
  });

  it("lists one object's tags when given a target", async () => {
    listOnTarget.mockResolvedValue([{ ...TAG, assignmentId: "a-1" }]);
    const target = { type: "station", id: "st-1" };
    const r = await exec(new TagListTool().build(ctx), { target });

    expect(listOnTarget).toHaveBeenCalledWith(ctx, target);
    expect(list).not.toHaveBeenCalled();
    expect(r).toEqual({
      tags: [
        {
          id: "tag-1",
          name: "Finance",
          color: "#2563EB",
          description: null,
          sourcePortalId: null,
          assignmentId: "a-1",
        },
      ],
    });
  });

  it("answers an unreadable target as not found", async () => {
    listOnTarget.mockRejectedValue(
      new ApiError(404, ApiCode.STATION_NOT_FOUND, "Station not found")
    );
    const r = await exec(new TagListTool().build(ctx), {
      target: { type: "station", id: "st-x" },
    });
    expect(r).toEqual({
      error: {
        code: ApiCode.TOOL_TARGET_NOT_FOUND,
        message: "Station not found",
      },
    });
  });

  it("rejects an unknown target type", () => {
    expect(
      new TagListTool().schema.safeParse({
        target: { type: "record", id: "r-1" },
      }).success
    ).toBe(false);
  });

  it("caps the page at 100", () => {
    expect(new TagListTool().schema.safeParse({ limit: 101 }).success).toBe(
      false
    );
  });
});

describe("tag_create", () => {
  it("creates the tag and records this session as its provenance", async () => {
    create.mockResolvedValue({ ...TAG, sourcePortalId: "portal-1" });
    const r = await exec(new TagCreateTool().build(ctx, "portal-1"), {
      name: "Finance",
      color: "#2563EB",
    });

    expect(create).toHaveBeenCalledWith(
      ctx,
      { name: "Finance", color: "#2563EB" },
      { sourcePortalId: "portal-1" }
    );
    expect(r).toEqual({
      success: true,
      entityTag: { ...TAG, sourcePortalId: "portal-1" },
    });
  });

  it("propagates a refusal to create for the permission gate", async () => {
    const err = new ApiError(403, ApiCode.PERMISSION_DENIED, "nope");
    create.mockRejectedValue(err);
    await expect(
      exec(new TagCreateTool().build(ctx, null), { name: "Finance" })
    ).rejects.toBe(err);
  });

  it("refuses a name over the limit", () => {
    expect(
      new TagCreateTool().schema.safeParse({ name: "x".repeat(121) }).success
    ).toBe(false);
  });
});

describe("tag_update", () => {
  it("updates the named tag", async () => {
    update.mockResolvedValue({ ...TAG, name: "Finance Ops" });
    const r = await exec(new TagUpdateTool().build(ctx), {
      tagId: "tag-1",
      name: "Finance Ops",
    });

    expect(update).toHaveBeenCalledWith(ctx, "tag-1", { name: "Finance Ops" });
    expect(r).toEqual({
      success: true,
      entityTag: { ...TAG, name: "Finance Ops" },
    });
  });

  it("needs at least one field to change", () => {
    expect(
      new TagUpdateTool().schema.safeParse({ tagId: "tag-1" }).success
    ).toBe(false);
  });
});

describe("tag_delete", () => {
  it("deletes the tag and reports what it came off", async () => {
    const removedFrom = {
      entity: 1,
      station: 2,
      pin: 0,
      connector_instance: 0,
      curated_view: 1,
    };
    del.mockResolvedValue({ id: "tag-1", removedFrom });
    const r = await exec(new TagDeleteTool().build(ctx), { tagId: "tag-1" });

    expect(del).toHaveBeenCalledWith(ctx, "tag-1", { countRemoved: true });
    expect(r).toEqual({ success: true, id: "tag-1", removedFrom });
  });

  it("answers an unreadable tag as not found", async () => {
    del.mockRejectedValue(
      new ApiError(404, ApiCode.ENTITY_TAG_NOT_FOUND, "Entity tag not found")
    );
    const r = await exec(new TagDeleteTool().build(ctx), { tagId: "tag-x" });
    expect(r).toEqual({
      error: {
        code: ApiCode.TOOL_TARGET_NOT_FOUND,
        message: "Entity tag not found",
      },
    });
  });
});
