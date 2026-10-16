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
const mockFieldMappingFindMany =
  jest.fn<(...args: unknown[]) => Promise<unknown[]>>();
const mockLockEntityIds = jest.fn<(m: unknown[]) => Promise<string[]>>();
const mockAssertNoneRunning =
  jest.fn<(targets: unknown, ctx: unknown) => Promise<void>>();

jest.unstable_mockModule("../../services/job-lock.service.js", () => ({
  JobLockService: {
    withUnlocked: mockWithUnlocked,
    assertNoneRunning: mockAssertNoneRunning,
  },
}));
jest.unstable_mockModule("../../services/db.service.js", () => ({
  DbService: {
    repository: { fieldMappings: { findMany: mockFieldMappingFindMany } },
  },
}));
jest.unstable_mockModule(
  "../../services/field-mapping-validation.service.js",
  () => ({
    FieldMappingValidationService: { lockEntityIds: mockLockEntityIds },
  })
);

const { wrapWithLockGate, valuesAtPath } =
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
  mockAssertNoneRunning.mockReset();
  mockAssertNoneRunning.mockResolvedValue(undefined);
  mockWithUnlocked.mockReset();
  mockWithUnlocked.mockImplementation(async (_t, _c, fn) => fn("tx"));
  mockFieldMappingFindMany.mockReset();
  mockLockEntityIds.mockReset();
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

  it("resolves field mapping ids to their entities (and counterparts') in one query", async () => {
    const mappings = [
      { id: "fm-1", connectorEntityId: "e9", organizationId: "org-1" },
    ];
    mockFieldMappingFindMany.mockResolvedValue(mappings);
    mockLockEntityIds.mockResolvedValue(["e9", "e-counterpart"]);
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

    expect(mockFieldMappingFindMany).toHaveBeenCalledTimes(1);
    expect(mockLockEntityIds).toHaveBeenCalledWith(mappings);
    expect(mockWithUnlocked.mock.calls[0][0]).toEqual([
      { kind: "fieldMapping", connectorEntityId: "e9" },
      { kind: "fieldMapping", connectorEntityId: "e-counterpart" },
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
    wrapWithLockGate(tools, ctx, () =>
      auth({ enqueues: "bulk_geocode", entityIdArgs: ["connectorEntityId"] })
    );

    const out = (await tools.t.execute!({}, {})) as {
      error: { code: string };
    };

    expect(mockWithUnlocked).not.toHaveBeenCalled();
    expect(out.error.code).toBe(ApiCode.ENTITY_LOCKED_BY_JOB);
  });

  it("#811: an enqueuing tool is refused before it runs when its entities are locked", async () => {
    mockAssertNoneRunning.mockRejectedValue(locked());
    const inner = jest.fn(async () => "ok");
    const tools: Record<string, Tool> = { t: { execute: inner } };
    wrapWithLockGate(tools, ctx, () =>
      auth({
        enqueues: "bulk_transform",
        entityIdArgs: [
          "sourceConnectorEntityId",
          "expression.writes[].targetConnectorEntityId",
        ],
      })
    );

    const out = (await tools.t.execute!(
      {
        sourceConnectorEntityId: "src",
        expression: {
          writes: [
            { targetConnectorEntityId: "a" },
            { targetConnectorEntityId: "b" },
            { targetConnectorEntityId: "a" },
          ],
        },
      },
      {}
    )) as { error: { code: string } };

    // Refused in the gate: the tool (and the cost gate inside it) never ran.
    expect(inner).not.toHaveBeenCalled();
    expect(out.error.code).toBe(ApiCode.ENTITY_LOCKED_BY_JOB);
    expect(mockAssertNoneRunning).toHaveBeenCalledWith(
      [
        { kind: "connectorEntity", id: "src" },
        { kind: "connectorEntity", id: "a" },
        { kind: "connectorEntity", id: "b" },
      ],
      ctx
    );
  });

  it("#811: an enqueuing tool with free entities runs", async () => {
    const inner = jest.fn(async () => "ok");
    const tools: Record<string, Tool> = { t: { execute: inner } };
    wrapWithLockGate(tools, ctx, () =>
      auth({ enqueues: "bulk_geocode", entityIdArgs: ["connectorEntityId"] })
    );

    expect(await tools.t.execute!({ connectorEntityId: "e1" }, {})).toBe("ok");
    expect(mockAssertNoneRunning).toHaveBeenCalledWith(
      [{ kind: "connectorEntity", id: "e1" }],
      ctx
    );
    expect(mockWithUnlocked).not.toHaveBeenCalled();
  });

  it("#811: valuesAtPath reads dotted keys and fans out over [] arrays", () => {
    const input = {
      a: "x",
      b: { list: [{ id: "1" }, { id: "" }, { id: 2 }, {}, { id: "3" }] },
    };
    expect(valuesAtPath(input, "a")).toEqual(["x"]);
    expect(valuesAtPath(input, "b.list[].id")).toEqual(["1", "3"]);
    expect(valuesAtPath(input, "b.missing[].id")).toEqual([]);
    expect(valuesAtPath(input, "a.deeper")).toEqual([]);
    expect(valuesAtPath(null, "a")).toEqual([]);
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

  it("holds at most two lock-gated calls per org at once; the rest wait their turn", async () => {
    let running = 0;
    let peak = 0;
    const releases: Array<() => void> = [];
    mockWithUnlocked.mockImplementation(async (_t, _c, fn) => {
      running++;
      peak = Math.max(peak, running);
      await new Promise<void>((r) => releases.push(r));
      running--;
      return fn("tx");
    });
    const tools: Record<string, Tool> = { t: { execute: async () => "ok" } };
    wrapWithLockGate(tools, ctx, () =>
      auth({
        target: "record",
        itemsArg: "items",
        idField: "connectorEntityId",
      })
    );

    const calls = [1, 2, 3].map(() =>
      tools.t.execute!({ items: [{ connectorEntityId: "e1" }] }, {})
    );
    await new Promise((r) => setTimeout(r, 10));
    expect(peak).toBe(2);
    while (releases.length > 0) {
      releases.shift()!();
      await new Promise((r) => setTimeout(r, 5));
    }

    await expect(Promise.all(calls)).resolves.toEqual(["ok", "ok", "ok"]);
    expect(peak).toBe(2);
  });

  it("a call that can't be admitted is a typed TOOL_WRITE_BUSY result", async () => {
    const inner = jest.fn(async () => "ok");
    const tools: Record<string, Tool> = { t: { execute: inner } };
    wrapWithLockGate(tools, ctx, () =>
      auth({
        target: "record",
        itemsArg: "items",
        idField: "connectorEntityId",
      })
    );
    const ac = new AbortController();
    ac.abort();

    const out = (await tools.t.execute!(
      { items: [{ connectorEntityId: "e1" }] },
      { abortSignal: ac.signal }
    )) as { error: { code: string } };

    expect(out.error.code).toBe(ApiCode.TOOL_WRITE_BUSY);
    expect(inner).not.toHaveBeenCalled();
  });
});
