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
  type RenderTileDeps,
  type TileQueryResult,
  type TileAggregation,
} from "../../services/portal-map-tile.service.js";
import { AGG_ZOOM_THRESHOLD } from "@portalai/core/constants";
import { ApiError } from "../../services/http.service.js";
import { ApiCode } from "../../constants/api-codes.constants.js";

const ORG = "org-1";
const PIPELINE = {
  sql: "SELECT geom FROM parcels",
  stationId: "station-1",
  organizationId: ORG,
};

/** A message carrying one d3 block whose content holds the durable pipeline. */
const messageWithPipeline = {
  id: "msg-1",
  organizationId: ORG,
  blocks: [{ type: "d3", content: { pipeline: PIPELINE } }],
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

  it("applies the simplify tolerance to the skeleton geometry", () => {
    expect(q()).toContain("ST_SimplifyPreserveTopology(r.g, 0.01)");
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
  const base = { z: 8, x: 40, y: 98, organizationId: ORG };

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
            content: { pipeline: PIPELINE },
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
