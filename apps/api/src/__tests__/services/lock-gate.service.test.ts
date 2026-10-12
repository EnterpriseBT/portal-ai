import { jest, describe, it, expect, beforeEach } from "@jest/globals";

import type { ToolAuthorization } from "@portalai/core/models";

// #769: the lock gate runs every write tool inside JobLockService.withUnlocked
// for the targets its items name, and turns a lock refusal into a typed tool
// result the agent can relay.

const mockWithUnlocked =
  jest.fn<
    (
      targets: unknown,
      ctx: unknown,
      fn: (tx: unknown) => Promise<unknown>
    ) => Promise<unknown>
  >();
const mockFieldMappingFindById = jest.fn<(id: string) => Promise<unknown>>();

jest.unstable_mockModule("../../services/job-lock.service.js", () => ({
  JobLockService: { withUnlocked: mockWithUnlocked },
}));
jest.unstable_mockModule("../../services/db.service.js", () => ({
  DbService: {
    repository: { fieldMappings: { findById: mockFieldMappingFindById } },
  },
}));

const { wrapWithLockGate } =
  await import("../../services/lock-gate.service.js");
const { ApiError } = await import("../../services/http.service.js");
const { ApiCode } = await import("../../constants/api-codes.constants.js");

type Tool = {
  execute?: (input: unknown, options: unknown) => Promise<unknown>;
};
const ctx = { organizationId: "org-1" };
const auth = (lock: ToolAuthorization["lock"]): ToolAuthorization => ({
  verb: "write",
  resourceType: "entity_record",
  mode: "create",
  lock,
});
const locked = () =>
  new ApiError(
    409,
    ApiCode.ENTITY_LOCKED_BY_JOB,
    "Revalidation is running on this entity. Try again when it finishes.",
    {
      recommendation: "Wait",
      details: { runningJobs: [{ id: "job-1", type: "revalidation" }] },
    }
  );

beforeEach(() => {
  mockWithUnlocked.mockReset();
  mockWithUnlocked.mockImplementation(async (_t, _c, fn) => fn("tx"));
  mockFieldMappingFindById.mockReset();
});

describe("wrapWithLockGate (#769)", () => {
  it("runs the tool inside withUnlocked for each item's target", async () => {
    const inner = jest.fn(async () => "ok");
    const tools: Record<string, Tool> = { t: { execute: inner } };
    wrapWithLockGate(tools, ctx, () =>
      auth({
        target: "record",
        itemsArg: "items",
        idField: "connectorEntityId",
      })
    );

    const out = await tools.t.execute!(
      { items: [{ connectorEntityId: "e1" }, { connectorEntityId: "e2" }] },
      {}
    );

    expect(out).toBe("ok");
    expect(mockWithUnlocked).toHaveBeenCalledWith(
      [
        { kind: "record", connectorEntityId: "e1" },
        { kind: "record", connectorEntityId: "e2" },
      ],
      ctx,
      expect.any(Function)
    );
    expect(inner).toHaveBeenCalledTimes(1);
  });

  it("names an object by its own id for entity, connector and column targets", async () => {
    const tools: Record<string, Tool> = {
      t: { execute: async () => "ok" },
    };
    wrapWithLockGate(tools, ctx, () =>
      auth({
        target: "connectorInstance",
        itemsArg: "items",
        idField: "connectorInstanceId",
      })
    );

    await tools.t.execute!({ items: [{ connectorInstanceId: "ci-1" }] }, {});

    expect(mockWithUnlocked.mock.calls[0][0]).toEqual([
      { kind: "connectorInstance", id: "ci-1" },
    ]);
  });

  it("resolves a field mapping id to its entity, in the caller's org", async () => {
    mockFieldMappingFindById.mockImplementation(async (id) =>
      id === "fm-1"
        ? { id, connectorEntityId: "e9", organizationId: "org-1" }
        : { id, connectorEntityId: "eX", organizationId: "other-org" }
    );
    const tools: Record<string, Tool> = {
      t: { execute: async () => "ok" },
    };
    wrapWithLockGate(tools, ctx, () =>
      auth({
        target: "fieldMapping",
        itemsArg: "items",
        idField: "fieldMappingId",
        resolve: "fieldMappingEntity",
      })
    );

    await tools.t.execute!(
      { items: [{ fieldMappingId: "fm-1" }, { fieldMappingId: "fm-2" }] },
      {}
    );

    // Another org's mapping resolves to nothing: the tool's own check fails it.
    expect(mockWithUnlocked.mock.calls[0][0]).toEqual([
      { kind: "fieldMapping", connectorEntityId: "e9" },
    ]);
  });

  it("turns a lock refusal into a typed result and never runs the tool", async () => {
    mockWithUnlocked.mockRejectedValue(locked());
    const inner = jest.fn(async () => "ok");
    const tools: Record<string, Tool> = { t: { execute: inner } };
    wrapWithLockGate(tools, ctx, () =>
      auth({
        target: "record",
        itemsArg: "items",
        idField: "connectorEntityId",
      })
    );

    const out = await tools.t.execute!(
      { items: [{ connectorEntityId: "e1" }] },
      {}
    );

    expect(inner).not.toHaveBeenCalled();
    expect(out).toEqual({
      error: {
        code: ApiCode.ENTITY_LOCKED_BY_JOB,
        message:
          "Revalidation is running on this entity. Try again when it finishes.",
        runningJobs: [{ id: "job-1", type: "revalidation" }],
      },
    });
  });

  it("an enqueuing tool runs unwrapped, and a lock refusal it throws becomes the typed result", async () => {
    const tools: Record<string, Tool> = {
      t: {
        execute: async () => {
          throw locked();
        },
      },
    };
    wrapWithLockGate(tools, ctx, () => auth({ enqueues: "bulk_geocode" }));

    const out = (await tools.t.execute!({}, {})) as {
      error: { code: string };
    };

    expect(mockWithUnlocked).not.toHaveBeenCalled();
    expect(out.error.code).toBe(ApiCode.ENTITY_LOCKED_BY_JOB);
  });

  it("other errors pass through untouched", async () => {
    mockWithUnlocked.mockRejectedValue(new Error("db down"));
    const tools: Record<string, Tool> = {
      t: { execute: async () => "ok" },
    };
    wrapWithLockGate(tools, ctx, () =>
      auth({
        target: "record",
        itemsArg: "items",
        idField: "connectorEntityId",
      })
    );

    await expect(
      tools.t.execute!({ items: [{ connectorEntityId: "e1" }] }, {})
    ).rejects.toThrow("db down");
  });

  it("a tool with no authorization entry, or no items, runs as before", async () => {
    const inner = jest.fn(async () => "ok");
    const tools: Record<string, Tool> = {
      read: { execute: inner },
      write: { execute: inner },
    };
    wrapWithLockGate(tools, ctx, (name) =>
      name === "write"
        ? auth({
            target: "record",
            itemsArg: "items",
            idField: "connectorEntityId",
          })
        : undefined
    );

    await tools.read.execute!({}, {});
    await tools.write.execute!({ items: [] }, {});

    expect(inner).toHaveBeenCalledTimes(2);
    expect(mockWithUnlocked).not.toHaveBeenCalled();
  });
});
