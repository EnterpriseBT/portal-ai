/**
 * Unit tests for DissolvePrecomputeService (#472, slice 3) — the pin-side
 * enqueue gate. `JobsService.create` is spied so nothing touches the DB/queue.
 */
import { jest, describe, it, expect, beforeEach } from "@jest/globals";

import { DissolvePrecomputeService } from "../../services/dissolve-precompute.service.js";
import { JobsService } from "../../services/jobs.service.js";

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

  it("rejects a polygon layer with no colorBy", () => {
    expect(
      DissolvePrecomputeService.isDissolvable("geo", {
        spec: {
          layers: [{ kind: "polygons", source: { geometryColumn: "geom" } }],
        },
      })
    ).toBe(false);
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
