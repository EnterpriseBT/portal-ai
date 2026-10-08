import { describe, it, expect } from "@jest/globals";

import {
  PortalMapTileService,
  MAP_TILE_FEATURE_CAP,
  propertyColumnsFromSpec,
  tileSimplifyTolerance,
  aggregationFromSpec,
  resolveTileMode,
  coverageSnapTolerance,
  aggregateCellSize,
  layerCountFromContent,
  mapTileError,
  tileSimplifyExpr,
  TILE_BUSY_RETRY_AFTER_S,
  type RenderTileDeps,
  type TileQueryResult,
  type TileAggregation,
} from "../../services/portal-map-tile.service.js";
import { AGG_ZOOM_THRESHOLD } from "@portalai/core/constants";
import { ApiError } from "../../services/http.service.js";
import { ApiCode } from "../../constants/api-codes.constants.js";
import { GateRejectedError } from "../../utils/admission-gate.util.js";
import { requestContext } from "../../utils/request-context.util.js";
import { instrumentQueryPrototype } from "../../db/request-cancellation.util.js";

const ORG = "org-1";
const PIPELINE = {
  sql: "SELECT geom FROM parcels",
  stationId: "station-1",
  organizationId: ORG,
};

/** #695: the smallest valid map spec. A `points` layer aggregates like the
 *  old spec-less fixture did (bins), so the render tests keep their meaning. */
const MAP_SPEC = {
  layers: [{ kind: "points", source: { geometryColumn: "geom" } }],
};

/** A message carrying one geo block whose content holds the durable pipeline. */
const messageWithPipeline = {
  id: "msg-1",
  organizationId: ORG,
  portalId: "portal-1",
  blocks: [{ type: "geo", content: { spec: MAP_SPEC, pipeline: PIPELINE } }],
};

function deps(
  over: Partial<RenderTileDeps> = {},
  query: TileQueryResult = {
    mvt: Buffer.from([1, 2, 3]),
    featureCount: 5,
    truncated: false,
    aggregated: false,
  }
): RenderTileDeps {
  return {
    findMessageById: async () => messageWithPipeline,
    findPortalResultById: async () => null,
    runTileQuery: async () => query,
    // #643: stub scope resolution + dissolve-existence probe so the unit tests
    // need no DB (a dissolve-treatment tile would otherwise hit the DB for the
    // ETag availability flag).
    resolveTileScopeHash: async () => "scope-test",
    dissolvePrecomputeExists: async () => false,
    ...over,
  };
}

async function expectNotFound(p: Promise<unknown>) {
  await expect(p).rejects.toMatchObject({
    status: 404,
    code: ApiCode.MAP_TILE_NOT_FOUND,
  });
}

describe("mapTileError (#449)", () => {
  it("maps a Drizzle-wrapped 57014 to a 504 MAP_TILE_TIMEOUT", () => {
    // The real failure: Drizzle wraps the pg error, so reading err.code missed
    // the 57014 and the timeout escaped as 500 UNKNOWN.
    const wrapped = {
      message: "Failed query: SELECT ST_AsMVT(...)",
      cause: {
        code: "57014",
        message: "canceling statement due to statement timeout",
      },
    };
    const mapped = mapTileError(wrapped);
    expect(mapped).toBeInstanceOf(ApiError);
    expect(mapped).toMatchObject({
      status: 504,
      code: ApiCode.MAP_TILE_TIMEOUT,
    });
  });

  it("maps a raw (unwrapped) 57014 to a 504 as well", () => {
    expect(mapTileError({ code: "57014" })).toMatchObject({
      status: 504,
      code: ApiCode.MAP_TILE_TIMEOUT,
    });
  });

  it("returns undefined for a non-timeout error (so it rethrows as-is)", () => {
    expect(mapTileError({ cause: { code: "42P01" } })).toBeUndefined();
    expect(mapTileError(new Error("boom"))).toBeUndefined();
  });
});

describe("tileSimplifyTolerance", () => {
  it("is 0 at high zoom (>= 15)", () => {
    expect(tileSimplifyTolerance(15)).toBe(0);
    expect(tileSimplifyTolerance(20)).toBe(0);
  });
  it("is positive and shrinks with zoom at low zoom", () => {
    expect(tileSimplifyTolerance(2)).toBeGreaterThan(tileSimplifyTolerance(8));
    expect(tileSimplifyTolerance(8)).toBeGreaterThan(0);
  });
});

describe("coverageSnapTolerance (#541)", () => {
  it("is >= a tile pixel and coarser at a coarser band", () => {
    // At each band's representative zoom it snaps COVERAGE_SNAP_FACTOR× coarser
    // than one pixel, so it never rounds below the simplify tolerance.
    expect(coverageSnapTolerance(6)).toBeGreaterThanOrEqual(
      tileSimplifyTolerance(6)
    );
    expect(coverageSnapTolerance(12)).toBeGreaterThan(0);
    // A coarser band (lower representative zoom) → a coarser snap.
    expect(coverageSnapTolerance(6)).toBeGreaterThan(coverageSnapTolerance(12));
  });
});

describe("propertyColumnsFromSpec (#314)", () => {
  it("collects colorBy columns + popup fields, excludes geom, tolerates single/double braces", () => {
    const spec = {
      layers: [
        { style: { colorBy: { column: "c_state_name" } } },
        { style: { colorBy: { column: "c_pop2000" } } },
        { source: { geometryColumn: "geom" } }, // no colorBy
      ],
      popup: {
        template: "State: {c_state_name} — pop {{c_pop2000}} at {geom}",
      },
    };
    const cols = propertyColumnsFromSpec(spec).sort();
    // c_state_name + c_pop2000; `geom` excluded even though the popup names it.
    expect(cols).toEqual(["c_pop2000", "c_state_name"]);
  });

  it("returns [] for a spec with no colorBy or popup", () => {
    expect(
      propertyColumnsFromSpec({
        layers: [{ source: { geometryColumn: "geom" } }],
      })
    ).toEqual([]);
  });
});

describe("aggregationFromSpec (#330/#337)", () => {
  it("defaults to on with the shared threshold when no aggregation block is present", () => {
    const agg = aggregationFromSpec({
      layers: [{ style: { colorBy: { column: "c_city" } } }],
    });
    expect(agg.enabled).toBe(true);
    expect(agg.zoomThreshold).toBe(AGG_ZOOM_THRESHOLD);
    expect(agg.colorByColumn).toBe("c_city");
  });

  it("reads the first layer's aggregation block + first colorBy column", () => {
    const agg = aggregationFromSpec({
      layers: [
        { aggregation: { enabled: false, zoomThreshold: 9, gridSizePx: 40 } },
        { style: { colorBy: { column: "c_state" } } },
      ],
    });
    expect(agg).toMatchObject({
      enabled: false,
      zoomThreshold: 9,
      gridSizePx: 40,
      colorByColumn: "c_state",
    });
  });

  it("colorByColumn is null when no layer has a colorBy (density mode)", () => {
    expect(
      aggregationFromSpec({ layers: [{ source: { geometryColumn: "geom" } }] })
        .colorByColumn
    ).toBeNull();
  });

  // #337 — per-kind treatment folded into enabled + rankByLength.
  it("a line layer defaults to raw (enabled:false) + rankByLength:true", () => {
    const agg = aggregationFromSpec({
      layers: [{ kind: "lines", source: { geometryColumn: "geom" } }],
    });
    expect(agg).toMatchObject({
      enabled: false,
      rankByLength: true,
      kind: "lines",
    });
  });

  it("a polygon layer (no colorBy) defaults to dissolve, not bins (#532)", () => {
    const agg = aggregationFromSpec({
      layers: [{ kind: "polygons", source: { geometryColumn: "geom" } }],
    });
    expect(agg).toMatchObject({
      enabled: true,
      rankByLength: false,
      kind: "polygons",
      treatment: "dissolve",
      colorByColumn: null,
    });
  });

  it("treatment:'bins' forces bins on a line (enabled:true)", () => {
    const agg = aggregationFromSpec({
      layers: [
        {
          kind: "lines",
          source: { geometryColumn: "geom" },
          aggregation: { treatment: "bins" },
        },
      ],
    });
    expect(agg.enabled).toBe(true);
  });

  it("treatment:'none' forces raw on a polygon (enabled:false)", () => {
    const agg = aggregationFromSpec({
      layers: [
        {
          kind: "polygons",
          source: { geometryColumn: "geom" },
          aggregation: { treatment: "none" },
        },
      ],
    });
    expect(agg.enabled).toBe(false);
  });

  it("an explicit enabled:false on a bins layer stays disabled", () => {
    const agg = aggregationFromSpec({
      layers: [
        {
          kind: "polygons",
          source: { geometryColumn: "geom" },
          aggregation: { enabled: false },
        },
      ],
    });
    expect(agg).toMatchObject({ enabled: false, rankByLength: false });
  });
});

describe("resolveTileMode (#532)", () => {
  const agg = (over: Partial<TileAggregation> = {}): TileAggregation => ({
    enabled: true,
    zoomThreshold: AGG_ZOOM_THRESHOLD,
    gridSizePx: 24,
    colorByColumn: null,
    kind: "points",
    treatment: "bins",
    rankByLength: false,
    ...over,
  });
  const call = (over: Partial<Parameters<typeof resolveTileMode>[0]> = {}) =>
    resolveTileMode({
      z: 5,
      aggregation: agg(),
      layerTotal: null,
      layerTotalExact: false,
      tileCount: null,
      cap: 10_000,
      dissolveReady: false,
      ...over,
    });

  it("whole-layer fast path: an exact count <= cap is raw at every zoom (#532)", () => {
    expect(call({ layerTotal: 415, layerTotalExact: true, z: 3 })).toBe("raw");
    expect(call({ layerTotal: 415, layerTotalExact: true, z: 12 })).toBe("raw");
  });

  it("an inexact/truncated total never takes the fast path", () => {
    // inexact total <= cap must not short-circuit to raw; with no probe it falls
    // back to the zoom threshold (aggregate at low zoom).
    expect(call({ layerTotal: 415, layerTotalExact: false, z: 3 })).toBe(
      "aggregate"
    );
  });

  it("per-tile count decides once probed: raw under cap, aggregate/hybrid over", () => {
    expect(call({ tileCount: 9_000 })).toBe("raw");
    expect(call({ tileCount: 10_001 })).toBe("aggregate");
    expect(
      call({ tileCount: 10_001, aggregation: agg({ kind: "lines" }) })
    ).toBe("hybrid-lines");
  });

  it("dissolve: ready → dissolve, miss → raw (never centroid bins)", () => {
    const dagg = agg({
      treatment: "dissolve",
      kind: "polygons",
      colorByColumn: "c",
    });
    expect(call({ aggregation: dagg, z: 5, dissolveReady: true })).toBe(
      "dissolve"
    );
    expect(call({ aggregation: dagg, z: 5, dissolveReady: false })).toBe("raw");
    // above the band ceiling a dissolve layer is raw regardless of readiness
    expect(call({ aggregation: dagg, z: 16, dissolveReady: true })).toBe("raw");
  });

  it("a no-colorBy polygon (treatment dissolve) over cap never returns 'aggregate' (#532)", () => {
    // aggregationFromSpec gives a no-colorBy polygon treatment "dissolve", so it
    // takes the dissolve branch — dissolve when ready, raw when not — NEVER the
    // centroid-bin "aggregate" path, even far over the cap.
    const poly = agg({
      treatment: "dissolve",
      kind: "polygons",
      colorByColumn: null,
    });
    expect(
      call({ aggregation: poly, z: 5, dissolveReady: true, tileCount: 999_999 })
    ).toBe("dissolve");
    expect(
      call({
        aggregation: poly,
        z: 5,
        dissolveReady: false,
        tileCount: 999_999,
      })
    ).toBe("raw");
  });

  it("interim fallback (no probe) reproduces the pre-#532 zoom threshold", () => {
    expect(call({ z: 5 })).toBe("aggregate"); // enabled, z < threshold
    expect(call({ z: 14 })).toBe("raw"); // threshold is exclusive
    expect(call({ z: 5, aggregation: agg({ enabled: false }) })).toBe("raw");
  });
});

describe("layerCountFromContent (#532)", () => {
  it("prefers matchedCount + its exactness flag", () => {
    expect(
      layerCountFromContent({ matchedCount: 500, matchedCountExact: true })
    ).toEqual({ layerTotal: 500, layerTotalExact: true });
    expect(
      layerCountFromContent({ matchedCount: 500, matchedCountExact: false })
    ).toEqual({ layerTotal: 500, layerTotalExact: false });
  });

  it("falls back to rowCount, exact only when not truncated", () => {
    expect(layerCountFromContent({ rowCount: 42, truncated: false })).toEqual({
      layerTotal: 42,
      layerTotalExact: true,
    });
    expect(layerCountFromContent({ rowCount: 42, truncated: true })).toEqual({
      layerTotal: 42,
      layerTotalExact: false,
    });
  });

  it("no envelope → no fast path", () => {
    expect(layerCountFromContent({})).toEqual({
      layerTotal: null,
      layerTotalExact: false,
    });
  });
});

describe("aggregateCellSize — nested tile-pyramid grid (#532)", () => {
  it("halves each zoom level so the grid nests (cellSize(z) = 2·cellSize(z+1))", () => {
    for (let z = 0; z < 14; z++) {
      expect(aggregateCellSize(z)).toBeCloseTo(2 * aggregateCellSize(z + 1), 6);
    }
  });

  it("is the tile pyramid subdivided AGG_GRID_LEVELS levels", () => {
    // WORLD_3857_WIDTH / 2^(z + 4) at z=6 → world / 2^10.
    expect(aggregateCellSize(6)).toBeCloseTo(40075016.685578488 / 2 ** 10, 3);
  });
});

describe("buildAggregateTileSql — nested grid + _agg flag (#532)", () => {
  it("uses the nested aggregateCellSize(z), not a gridSizePx-derived lattice", () => {
    const q = PortalMapTileService.buildAggregateTileSql(
      "SELECT geom FROM parcels",
      6,
      "ST_TileEnvelope(6, 20, 24)",
      {
        enabled: true,
        zoomThreshold: AGG_ZOOM_THRESHOLD,
        gridSizePx: 24,
        colorByColumn: null,
        kind: "points",
        treatment: "bins",
        rankByLength: false,
      },
      MAP_TILE_FEATURE_CAP
    );
    // The snap uses the nested cell size; z and z+1 differ by exactly 2x.
    expect(q).toContain(String(aggregateCellSize(6)));
  });

  it("emits `1 AS _agg` so the client separates bins from raw features", () => {
    const q = PortalMapTileService.buildAggregateTileSql(
      "SELECT geom FROM parcels",
      6,
      "ST_TileEnvelope(6, 20, 24)",
      {
        enabled: true,
        zoomThreshold: AGG_ZOOM_THRESHOLD,
        gridSizePx: 24,
        colorByColumn: null,
        kind: "points",
        treatment: "bins",
        rankByLength: false,
      },
      MAP_TILE_FEATURE_CAP
    );
    expect(q).toContain("1 AS _agg");
  });
});

describe("buildLineHybridTileSql — skeleton + remainder bins (#532 slice 4)", () => {
  const q = () =>
    PortalMapTileService.buildLineHybridTileSql(
      "SELECT geom FROM roads",
      6,
      "ST_TileEnvelope(6, 20, 24)",
      0.01,
      MAP_TILE_FEATURE_CAP
    );

  it("ranks by projected length and draws the longest `cap` as the raw skeleton", () => {
    const sql = q();
    expect(sql).toContain("ST_Length(ST_Transform(src.geom, 3857)) DESC");
    expect(sql).toContain(`r.rn <= ${MAP_TILE_FEATURE_CAP}`);
    // Skeleton features carry no `_agg` flag (0), so the client draws them as lines.
    expect(sql).toContain("0 AS _agg");
  });

  it("summarises the remainder (rn > cap) as density bins on the nested grid, flagged `_agg`", () => {
    const sql = q();
    expect(sql).toContain(`r.rn > ${MAP_TILE_FEATURE_CAP}`);
    expect(sql).toContain(String(aggregateCellSize(6)));
    expect(sql).toContain("1 AS _agg");
    // A summary never reports truncation.
    expect(sql).toContain("0 AS n_limited");
  });

  it("simplifies the skeleton lines with ST_Simplify, not the topology-preserving variant (#698)", () => {
    const sql = q();
    expect(sql).toContain("ST_Simplify(r.g, 0.01)");
    expect(sql).not.toContain("ST_SimplifyPreserveTopology");
  });
});

describe("tileSimplifyExpr — per-kind simplify (#698)", () => {
  it("keeps topology for polygons (ring validity)", () => {
    expect(tileSimplifyExpr("g", 0.5, "polygons")).toBe(
      "ST_SimplifyPreserveTopology(g, 0.5)"
    );
  });

  it("uses plain ST_Simplify for lines and points", () => {
    expect(tileSimplifyExpr("g", 0.5, "lines")).toBe("ST_Simplify(g, 0.5)");
    expect(tileSimplifyExpr("g", 0.5, "points")).toBe("ST_Simplify(g, 0.5)");
  });

  it("falls back to the topology-preserving simplify for an unknown kind", () => {
    expect(tileSimplifyExpr("g", 0.5, null)).toBe(
      "ST_SimplifyPreserveTopology(g, 0.5)"
    );
  });

  it("returns the bare expression at tolerance 0", () => {
    expect(tileSimplifyExpr("src.geom", 0, "lines")).toBe("src.geom");
    expect(tileSimplifyExpr("src.geom", 0, "polygons")).toBe("src.geom");
  });
});

describe("buildRawTileSql — per-kind simplify (#698)", () => {
  const build = (kind: "lines" | "polygons" | "points" | null) =>
    PortalMapTileService.buildRawTileSql(
      "SELECT geom FROM contours",
      "ST_TileEnvelope(3, 1, 3)",
      [],
      0.01,
      MAP_TILE_FEATURE_CAP,
      kind === "lines",
      kind
    );

  it("simplifies a lines layer with ST_Simplify", () => {
    const sql = build("lines");
    expect(sql).toContain("ST_Simplify(src.geom, 0.01)");
    expect(sql).not.toContain("ST_SimplifyPreserveTopology");
  });

  it("simplifies a points layer with ST_Simplify", () => {
    expect(build("points")).toContain("ST_Simplify(src.geom, 0.01)");
  });

  it("keeps ST_SimplifyPreserveTopology for polygons and an unknown kind", () => {
    expect(build("polygons")).toContain(
      "ST_SimplifyPreserveTopology(src.geom, 0.01)"
    );
    expect(build(null)).toContain(
      "ST_SimplifyPreserveTopology(src.geom, 0.01)"
    );
  });
});

describe("buildRawTileSql — importance ranking (#337)", () => {
  const base = () =>
    PortalMapTileService.buildRawTileSql(
      "SELECT geom FROM roads",
      "ST_TileEnvelope(8, 48, 96)",
      [],
      0,
      MAP_TILE_FEATURE_CAP,
      false
    );

  it("omits ORDER BY when rankByLength is false (unchanged raw SQL)", () => {
    expect(base()).not.toContain("ORDER BY");
  });

  it("orders by ST_Length DESC before LIMIT when rankByLength is true", () => {
    const q = PortalMapTileService.buildRawTileSql(
      "SELECT geom FROM roads",
      "ST_TileEnvelope(8, 48, 96)",
      [],
      0,
      MAP_TILE_FEATURE_CAP,
      true
    );
    expect(q).toContain(
      "ORDER BY ST_Length(ST_Transform(src.geom, 3857)) DESC"
    );
    // ranking sits inside the capped CTE — before the LIMIT.
    expect(q.indexOf("ORDER BY")).toBeLessThan(q.indexOf("LIMIT"));
  });
});

describe("PortalMapTileService.renderTile (#316)", () => {
  const base = {
    z: 8,
    x: 40,
    y: 98,
    organizationId: ORG,
    userId: "u-test",
    authorizeSource: async () => true,
  };
  const msgRef = {
    ref: { kind: "message" as const, messageId: "msg-1", blockIndex: 0 },
    ...base,
  };

  it("#643: the ETag varies by the caller's scope hash", async () => {
    const a = await PortalMapTileService.renderTile(
      msgRef,
      deps({ resolveTileScopeHash: async () => "scope-A" })
    );
    const b = await PortalMapTileService.renderTile(
      msgRef,
      deps({ resolveTileScopeHash: async () => "scope-B" })
    );
    const a2 = await PortalMapTileService.renderTile(
      msgRef,
      deps({ resolveTileScopeHash: async () => "scope-A" })
    );
    expect(a.etag).not.toBe(b.etag); // different scope → different tile cache
    expect(a.etag).toBe(a2.etag); // same scope → shared ETag
  });

  it("#643: the ETag flips when a dissolve precompute becomes available (a completed lazy fill busts a stale 304)", async () => {
    // A polygon (dissolve-treatment) layer at z=8 (dissolve band 2, in-band).
    const polygonMsg = {
      id: "msg-poly",
      organizationId: ORG,
      blocks: [
        {
          type: "geo",
          content: {
            spec: {
              layers: [
                { kind: "polygons", source: { geometryColumn: "geom" } },
              ],
            },
            pipeline: PIPELINE,
          },
        },
      ],
    };
    const polyRef = {
      ref: { kind: "message" as const, messageId: "msg-poly", blockIndex: 0 },
      ...base,
    };
    const raw = await PortalMapTileService.renderTile(
      polyRef,
      deps({
        findMessageById: async () => polygonMsg,
        dissolvePrecomputeExists: async () => false,
      })
    );
    const dissolved = await PortalMapTileService.renderTile(
      polyRef,
      deps({
        findMessageById: async () => polygonMsg,
        dissolvePrecomputeExists: async () => true,
      })
    );
    // Raw-fallback tile and the later dissolved tile for the SAME scope must not
    // share an ETag — otherwise the client's If-None-Match returns 304 forever
    // and never receives the dissolved rendering.
    expect(raw.etag).not.toBe(dissolved.etag);
  });

  // #692: the tile source is authorized for the caller, not just org-scoped.
  // A message's portal is per-user (#685) and a pin is read-checked, so the
  // router passes an authorizer; refusal is the same 404 as a missing tile.
  it("#692: 404s a message tile whose portal the caller can't read, before running anything", async () => {
    const seen: unknown[] = [];
    let ran = false;
    await expectNotFound(
      PortalMapTileService.renderTile(
        {
          ...base,
          ref: { kind: "message", messageId: "msg-1", blockIndex: 0 },
          authorizeSource: async (source) => {
            seen.push(source);
            return false;
          },
        },
        deps({
          runTileQuery: async () => {
            ran = true;
            return {
              mvt: Buffer.from([1]),
              featureCount: 1,
              truncated: false,
              aggregated: false,
            };
          },
        })
      )
    );
    expect(seen).toEqual([{ kind: "message", portalId: "portal-1" }]);
    expect(ran).toBe(false);
  });

  it("#692: 404s a pin tile the caller can't read", async () => {
    const seen: unknown[] = [];
    await expectNotFound(
      PortalMapTileService.renderTile(
        {
          ...base,
          ref: { kind: "pin", portalResultId: "p-1" },
          authorizeSource: async (source) => {
            seen.push(source);
            return false;
          },
        },
        deps({
          findPortalResultById: async () => ({
            id: "p-1",
            organizationId: ORG,
            createdBy: "u-owner",
            type: "geo",
            content: { spec: MAP_SPEC, pipeline: PIPELINE },
          }),
        })
      )
    );
    expect(seen).toEqual([{ kind: "pin", id: "p-1", createdBy: "u-owner" }]);
  });

  it("404s for an unknown message", async () => {
    await expectNotFound(
      PortalMapTileService.renderTile(
        { ref: { kind: "message", messageId: "nope", blockIndex: 0 }, ...base },
        deps({ findMessageById: async () => null })
      )
    );
  });

  it("404s (not 403) for a cross-org message — no existence leak", async () => {
    await expectNotFound(
      PortalMapTileService.renderTile(
        {
          ref: { kind: "message", messageId: "msg-1", blockIndex: 0 },
          ...base,
        },
        deps({
          findMessageById: async () => ({
            ...messageWithPipeline,
            organizationId: "other-org",
          }),
        })
      )
    );
  });

  // #695: a table or chart carries the same durable pipeline as a map, but
  // has no geometry. Its tile is absent (404), and no SQL runs.
  it("404s for a non-map block with a valid pipeline, without running the query", async () => {
    let ran = 0;
    for (const block of [
      { type: "data-table", content: { pipeline: PIPELINE } },
      { type: "d3", content: { spec: { mark: "bar" }, pipeline: PIPELINE } },
    ]) {
      await expectNotFound(
        PortalMapTileService.renderTile(
          {
            ref: { kind: "message", messageId: "msg-1", blockIndex: 0 },
            ...base,
          },
          deps({
            findMessageById: async () => ({
              ...messageWithPipeline,
              blocks: [block],
            }),
            runTileQuery: async () => {
              ran++;
              throw new Error("tile query must not run");
            },
          })
        )
      );
    }
    expect(ran).toBe(0);
  });

  // #695 (code review): "is this a map" is the block's type, not how strictly
  // its stored spec parses, so a later tightening of MapSpecSchema can't
  // blank a stored map.
  it("still renders a geo block whose stored spec no longer parses as a MapSpec", async () => {
    const res = await PortalMapTileService.renderTile(
      {
        ref: { kind: "message", messageId: "msg-1", blockIndex: 0 },
        ...base,
      },
      deps({
        findMessageById: async () => ({
          ...messageWithPipeline,
          blocks: [
            {
              type: "geo",
              content: { spec: { layers: [] }, pipeline: PIPELINE },
            },
          ],
        }),
      })
    );
    expect(res.status).toBe(200);
  });

  it("404s for a pinned non-map result with a valid pipeline", async () => {
    await expectNotFound(
      PortalMapTileService.renderTile(
        { ref: { kind: "pin", portalResultId: "p-1" }, ...base },
        deps({
          findPortalResultById: async () => ({
            id: "p-1",
            organizationId: ORG,
            createdBy: "u-owner",
            type: "data-table",
            content: { pipeline: PIPELINE },
          }),
          runTileQuery: async () => {
            throw new Error("tile query must not run");
          },
        })
      )
    );
  });

  it("404s for a block with no durable pipeline", async () => {
    await expectNotFound(
      PortalMapTileService.renderTile(
        {
          ref: { kind: "message", messageId: "msg-1", blockIndex: 0 },
          ...base,
        },
        deps({
          findMessageById: async () => ({
            id: "msg-1",
            organizationId: ORG,
            blocks: [{ type: "text", content: {} }],
          }),
        })
      )
    );
  });

  it("404s for an out-of-range blockIndex", async () => {
    await expectNotFound(
      PortalMapTileService.renderTile(
        {
          ref: { kind: "message", messageId: "msg-1", blockIndex: 9 },
          ...base,
        },
        deps()
      )
    );
  });

  it("404s for an unknown / cross-org pin", async () => {
    await expectNotFound(
      PortalMapTileService.renderTile(
        { ref: { kind: "pin", portalResultId: "p-1" }, ...base },
        deps({ findPortalResultById: async () => null })
      )
    );
    await expectNotFound(
      PortalMapTileService.renderTile(
        { ref: { kind: "pin", portalResultId: "p-1" }, ...base },
        deps({
          findPortalResultById: async () => ({
            organizationId: "other",
            type: "geo",
            content: { spec: MAP_SPEC, pipeline: PIPELINE },
          }),
        })
      )
    );
  });

  it("renders 200 with the MVT bytes for a populated envelope", async () => {
    const res = await PortalMapTileService.renderTile(
      { ref: { kind: "message", messageId: "msg-1", blockIndex: 0 }, ...base },
      deps()
    );
    expect(res.status).toBe(200);
    expect(res.body).toEqual(Buffer.from([1, 2, 3]));
    expect(res.etag).toMatch(/^"[ar]~[0-9a-f]{32}"$/);
  });

  it("sets simplifiedTolerance at low zoom, null at high zoom", async () => {
    const low = await PortalMapTileService.renderTile(
      {
        ref: { kind: "message", messageId: "msg-1", blockIndex: 0 },
        ...base,
        z: 6,
      },
      deps()
    );
    expect(low.simplifiedTolerance).toBeGreaterThan(0);

    const high = await PortalMapTileService.renderTile(
      {
        ref: { kind: "message", messageId: "msg-1", blockIndex: 0 },
        ...base,
        z: 18,
        x: 0,
        y: 0,
      },
      deps()
    );
    expect(high.simplifiedTolerance).toBeNull();
  });

  it("flags truncatedCap from the query's `truncated`, even when the rendered count is under the cap (#314)", async () => {
    // The clip is reported by the LIMITed row count, not the rendered feature
    // count — boundary features clip to null geometry, so `featureCount` lands
    // just under the cap on a genuinely-clipped tile. Truncation must still fire
    // (no silent degradation).
    const res = await PortalMapTileService.renderTile(
      { ref: { kind: "message", messageId: "msg-1", blockIndex: 0 }, ...base },
      deps(
        {},
        {
          mvt: Buffer.from([9]),
          featureCount: MAP_TILE_FEATURE_CAP - 7, // rendered < cap …
          truncated: true, // … but the LIMIT clipped
          aggregated: false,
        }
      )
    );
    expect(res.status).toBe(200);
    expect(res.truncatedCap).toBe(MAP_TILE_FEATURE_CAP);
  });

  it("an aggregated tile suppresses the truncated + simplified notices (#330)", async () => {
    const res = await PortalMapTileService.renderTile(
      {
        ref: { kind: "message", messageId: "msg-1", blockIndex: 0 },
        ...base,
        z: 6, // low zoom — would normally carry a simplified tolerance
      },
      deps(
        {},
        {
          mvt: Buffer.from([7]),
          featureCount: 40, // 40 bins
          truncated: true, // even a truthy truncated is suppressed …
          aggregated: true, // … because the tile is an aggregate
        }
      )
    );
    expect(res.status).toBe(200);
    expect(res.aggregated).toBe(true);
    expect(res.truncatedCap).toBeNull();
    expect(res.simplifiedTolerance).toBeNull();
  });

  it("returns 204 for a genuinely empty envelope", async () => {
    const res = await PortalMapTileService.renderTile(
      { ref: { kind: "message", messageId: "msg-1", blockIndex: 0 }, ...base },
      deps(
        {},
        { mvt: null, featureCount: 0, truncated: false, aggregated: false }
      )
    );
    expect(res.status).toBe(204);
    expect(res.body).toBeUndefined();
    expect(res.etag).toMatch(/^"[ar]~[0-9a-f]{32}"$/);
  });

  it("returns 304 when If-None-Match equals the tile ETag", async () => {
    const first = await PortalMapTileService.renderTile(
      { ref: { kind: "message", messageId: "msg-1", blockIndex: 0 }, ...base },
      deps()
    );
    const second = await PortalMapTileService.renderTile(
      {
        ref: { kind: "message", messageId: "msg-1", blockIndex: 0 },
        ...base,
        ifNoneMatch: first.etag,
      },
      deps()
    );
    expect(second.status).toBe(304);
    expect(second.body).toBeUndefined();
  });

  it("the ETag mode prefix lets a 304 report `aggregated` without a query (#532)", async () => {
    let queries = 0;
    const countingDeps = (aggregated: boolean): RenderTileDeps => ({
      findMessageById: async () => messageWithPipeline,
      findPortalResultById: async () => null,
      resolveTileScopeHash: async () => "scope-test",
      runTileQuery: async () => {
        queries++;
        return {
          mvt: Buffer.from([1]),
          featureCount: 3,
          truncated: false,
          aggregated,
        };
      },
    });
    const first = await PortalMapTileService.renderTile(
      { ref: { kind: "message", messageId: "msg-1", blockIndex: 0 }, ...base },
      countingDeps(true)
    );
    expect(first.etag).toMatch(/^"a~/); // aggregated tile → `a` prefix
    expect(queries).toBe(1);

    const notModified = await PortalMapTileService.renderTile(
      {
        ref: { kind: "message", messageId: "msg-1", blockIndex: 0 },
        ...base,
        ifNoneMatch: first.etag,
      },
      countingDeps(true)
    );
    expect(notModified.status).toBe(304);
    expect(notModified.aggregated).toBe(true); // read from the ETag prefix …
    expect(queries).toBe(1); // … no second query ran
  });

  it("a stale-format If-None-Match re-renders (cache-bust across the salt/format change, #532)", async () => {
    const stale = await PortalMapTileService.renderTile(
      {
        ref: { kind: "message", messageId: "msg-1", blockIndex: 0 },
        ...base,
        ifNoneMatch: '"0123456789abcdef0123456789abcdef"', // pre-#532 prefixless
      },
      deps()
    );
    expect(stale.status).toBe(200);
  });

  it("propagates a 504 timeout from the tile query", async () => {
    await expect(
      PortalMapTileService.renderTile(
        {
          ref: { kind: "message", messageId: "msg-1", blockIndex: 0 },
          ...base,
        },
        deps({
          runTileQuery: async () => {
            throw new ApiError(504, ApiCode.MAP_TILE_TIMEOUT, "timed out");
          },
        })
      )
    ).rejects.toMatchObject({ status: 504, code: ApiCode.MAP_TILE_TIMEOUT });
  });
});

describe("renderTile — tile admission gate (#698)", () => {
  const ref = {
    ref: { kind: "message" as const, messageId: "msg-1", blockIndex: 0 },
    z: 8,
    x: 40,
    y: 98,
    organizationId: ORG,
    userId: "u-test",
    authorizeSource: async () => true,
  };
  /** A gate that records each admission key and runs the work. */
  const recordingGate = () => {
    const keys: string[] = [];
    return {
      keys,
      gate: {
        run: async <T>(
          key: string,
          _s: AbortSignal | undefined,
          fn: () => Promise<T>
        ) => {
          keys.push(key);
          return fn();
        },
      },
    };
  };
  const rejectingGate = (reason: "queue_full" | "timeout" | "aborted") => ({
    run: async () => {
      throw new GateRejectedError(reason);
    },
  });

  it("runs the tile query through the gate, keyed by the caller's org", async () => {
    const { keys, gate } = recordingGate();
    const res = await PortalMapTileService.renderTile(ref, deps({ gate }));
    expect(res.status).toBe(200);
    expect(keys).toEqual([ORG]);
  });

  it("serves a 304 without taking a gate slot", async () => {
    const first = await PortalMapTileService.renderTile(ref, deps());
    const { keys, gate } = recordingGate();
    const second = await PortalMapTileService.renderTile(
      { ...ref, ifNoneMatch: first.etag },
      deps({ gate })
    );
    expect(second.status).toBe(304);
    expect(keys).toEqual([]);
  });

  it.each(["queue_full", "timeout"] as const)(
    "maps a saturated gate (%s) to 503 MAP_TILE_BUSY with a retry hint",
    async (reason) => {
      await expect(
        PortalMapTileService.renderTile(
          ref,
          deps({ gate: rejectingGate(reason) })
        )
      ).rejects.toMatchObject({
        status: 503,
        code: ApiCode.MAP_TILE_BUSY,
        details: { retryAfterSeconds: TILE_BUSY_RETRY_AFTER_S },
      });
    }
  );

  it("maps a tile abandoned while waiting for a slot to REQUEST_ABANDONED", async () => {
    await expect(
      PortalMapTileService.renderTile(
        ref,
        deps({ gate: rejectingGate("aborted") })
      )
    ).rejects.toMatchObject({ status: 499, code: ApiCode.REQUEST_ABANDONED });
  });

  it("mapTileError reports a request-cancelled 57014 as the cancellation, not MAP_TILE_TIMEOUT", async () => {
    // A minimal stand-in for postgres.js's Query, cancelled for real by the
    // instrumentation (queued, client already gone) — so the error is the one
    // the instrumentation attributed, not a hand-built lookalike.
    class StubQuery extends Promise<unknown> {
      static get [Symbol.species]() {
        return Promise;
      }
      state: object | null = null;
      executed = false;
      private rejectFn!: (e: unknown) => void;
      constructor() {
        let rej!: (e: unknown) => void;
        super((_res, r) => {
          rej = r;
        });
        this.rejectFn = rej;
      }
      handle(): void {
        this.executed = true;
      }
      cancel(): void {
        this.rejectFn(
          Object.assign(new Error("canceling statement"), { code: "57014" })
        );
      }
    }
    instrumentQueryPrototype(StubQuery.prototype);
    const controller = new AbortController();
    controller.abort("client_gone");
    const q = new StubQuery();
    requestContext.run(
      {
        log: undefined as never,
        signal: controller.signal,
        dbCancelPolicy: "always",
      },
      () => q.handle()
    );
    const cancelled = await q.then(
      () => undefined,
      (e: unknown) => e
    );
    const wrapped = Object.assign(new Error("Failed query"), {
      cause: cancelled,
    });
    expect(mapTileError(wrapped)?.code).toBe(ApiCode.REQUEST_ABANDONED);

    // A 57014 the instrumentation didn't cause is still a real tile timeout.
    const timeout = Object.assign(new Error("Failed query"), {
      cause: Object.assign(new Error("statement timeout"), { code: "57014" }),
    });
    expect(mapTileError(timeout)?.code).toBe(ApiCode.MAP_TILE_TIMEOUT);
  });
});
