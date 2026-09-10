/**
 * Unit tests for DissolvePrecomputeService (#472, slice 3) — the pin-side
 * enqueue gate. `JobsService.create` is spied so nothing touches the DB/queue.
 */
import { jest, describe, it, expect, beforeEach } from "@jest/globals";

import { DissolvePrecomputeService } from "../../services/dissolve-precompute.service.js";
import { JobsService } from "../../services/jobs.service.js";
import { db } from "../../db/client.js";

const polygonChoropleth = {
  spec: {
    layers: [
      {
        kind: "polygons",
        source: { geometryColumn: "geom" },
        style: { colorBy: { column: "c_own_type" } },
      },
    ],
  },
  pipeline: { sql: "SELECT geom, c_own_type FROM parcels" },
};

describe("DissolvePrecomputeService.isDissolvable", () => {
  it("accepts a geo polygon layer with a colorBy", () => {
    expect(
      DissolvePrecomputeService.isDissolvable("geo", polygonChoropleth)
    ).toBe(true);
  });

  it("accepts a polygon layer with no colorBy (#532 dissolve-all)", () => {
    expect(
      DissolvePrecomputeService.isDissolvable("geo", {
        spec: {
          layers: [{ kind: "polygons", source: { geometryColumn: "geom" } }],
        },
      })
    ).toBe(true);
  });

  it("rejects a non-polygon (points) layer even with a colorBy", () => {
    expect(
      DissolvePrecomputeService.isDissolvable("geo", {
        spec: {
          layers: [
            {
              kind: "points",
              source: { latColumn: "lat", lngColumn: "lng" },
              style: { colorBy: { column: "cat" } },
            },
          ],
        },
      })
    ).toBe(false);
  });

  it("rejects a non-geo pin", () => {
    expect(
      DissolvePrecomputeService.isDissolvable("data-table", polygonChoropleth)
    ).toBe(false);
  });

  it("tolerates malformed content", () => {
    expect(DissolvePrecomputeService.isDissolvable("geo", null)).toBe(false);
    expect(DissolvePrecomputeService.isDissolvable("geo", {})).toBe(false);
    expect(
      DissolvePrecomputeService.isDissolvable("geo", { spec: { layers: 5 } })
    ).toBe(false);
  });
});

describe("DissolvePrecomputeService.enqueueForPin", () => {
  let createSpy: ReturnType<typeof jest.spyOn>;

  beforeEach(() => {
    jest.restoreAllMocks();
    createSpy = jest
      .spyOn(JobsService, "create")
      .mockResolvedValue({ id: "job-1" } as never);
  });

  const call = (
    overrides: Partial<
      Parameters<typeof DissolvePrecomputeService.enqueueForPin>[0]
    > = {}
  ) =>
    DissolvePrecomputeService.enqueueForPin({
      portalResultId: "pr-1",
      organizationId: "org-1",
      userId: "user-1",
      type: "geo",
      content: polygonChoropleth,
      ...overrides,
    });

  it("enqueues a dissolve_precompute job for a qualifying pin", async () => {
    await call();
    expect(createSpy).toHaveBeenCalledTimes(1);
    const [userId, params] = createSpy.mock.calls[0] as [
      string,
      {
        type: string;
        organizationId: string;
        metadata: Record<string, unknown>;
      },
    ];
    expect(userId).toBe("user-1");
    expect(params.type).toBe("dissolve_precompute");
    expect(params.organizationId).toBe("org-1");
    expect(params.metadata).toEqual({
      portalResultId: "pr-1",
      organizationId: "org-1",
    });
  });

  it("does not enqueue for a non-qualifying pin", async () => {
    await call({ type: "data-table" });
    expect(createSpy).not.toHaveBeenCalled();
  });

  it("swallows an enqueue failure — never throws (pin must not fail)", async () => {
    createSpy.mockRejectedValueOnce(new Error("queue down") as never);
    await expect(call()).resolves.toBeUndefined();
  });
});

describe("DissolvePrecomputeService.reenqueueAllDissolvable (#541)", () => {
  beforeEach(() => {
    jest.restoreAllMocks();
  });

  it("enqueues once per dissolvable pin, skips non-polygon / non-geo", async () => {
    jest.spyOn(db, "execute").mockResolvedValue([
      {
        id: "p1",
        organizationId: "o1",
        type: "geo",
        content: polygonChoropleth,
      },
      {
        id: "p2",
        organizationId: "o1",
        type: "geo",
        content: { spec: { layers: [{ kind: "points" }] } },
      },
      { id: "p3", organizationId: "o1", type: "table", content: {} },
    ] as never);
    const createSpy = jest
      .spyOn(JobsService, "create")
      .mockResolvedValue({ id: "job" } as never);

    const res = await DissolvePrecomputeService.reenqueueAllDissolvable();

    // Only p1 (a geo polygon layer) is dissolvable.
    expect(res.enqueued).toBe(1);
    expect(createSpy).toHaveBeenCalledTimes(1);
    const [, params] = createSpy.mock.calls[0] as [
      string,
      { metadata: Record<string, unknown> },
    ];
    expect(params.metadata).toEqual({
      portalResultId: "p1",
      organizationId: "o1",
    });
  });

  it("returns { enqueued: 0 } when there are no dissolvable pins", async () => {
    jest.spyOn(db, "execute").mockResolvedValue([] as never);
    const createSpy = jest.spyOn(JobsService, "create");
    const res = await DissolvePrecomputeService.reenqueueAllDissolvable();
    expect(res.enqueued).toBe(0);
    expect(createSpy).not.toHaveBeenCalled();
  });
});

describe("DissolvePrecomputeService.enqueueForMessageBlock (#542)", () => {
  beforeEach(() => {
    jest.restoreAllMocks();
  });

  const call = (block: unknown) =>
    DissolvePrecomputeService.enqueueForMessageBlock({
      messageId: "m-1",
      blockIndex: 2,
      organizationId: "org-1",
      userId: "u-1",
      block: block as { type?: string; content?: unknown },
    });

  it("enqueues for an over-cap polygon block; metadata carries messageId+blockIndex", async () => {
    const spy = jest
      .spyOn(JobsService, "create")
      .mockResolvedValue({ id: "job" } as never);
    await call({
      type: "geo",
      content: { ...polygonChoropleth, matchedCount: 20_000 },
    });
    expect(spy).toHaveBeenCalledTimes(1);
    const [, params] = spy.mock.calls[0] as [
      string,
      { metadata: Record<string, unknown> },
    ];
    expect(params.metadata).toEqual({
      organizationId: "org-1",
      messageId: "m-1",
      blockIndex: 2,
    });
  });

  it("skips an under-cap polygon block (the raw fast path never-drops)", async () => {
    const spy = jest.spyOn(JobsService, "create");
    await call({
      type: "geo",
      content: { ...polygonChoropleth, matchedCount: 100 },
    });
    expect(spy).not.toHaveBeenCalled();
  });

  it("skips non-polygon and non-geo blocks", async () => {
    const spy = jest.spyOn(JobsService, "create");
    await call({
      type: "geo",
      content: { spec: { layers: [{ kind: "points" }] }, matchedCount: 20_000 },
    });
    await call({ type: "text", content: {} });
    expect(spy).not.toHaveBeenCalled();
  });
});
