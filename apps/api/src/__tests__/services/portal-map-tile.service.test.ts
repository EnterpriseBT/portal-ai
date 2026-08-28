import { describe, it, expect } from "@jest/globals";

import {
  PortalMapTileService,
  MAP_TILE_FEATURE_CAP,
  propertyColumnsFromSpec,
  tileSimplifyTolerance,
  aggregationFromSpec,
  shouldAggregate,
  mapTileError,
  type RenderTileDeps,
  type TileQueryResult,
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

describe("aggregationFromSpec + shouldAggregate (#330)", () => {
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

  it("a polygon layer stays binned (enabled:true) + rankByLength:false", () => {
    const agg = aggregationFromSpec({
      layers: [{ kind: "polygons", source: { geometryColumn: "geom" } }],
    });
    expect(agg).toMatchObject({
      enabled: true,
      rankByLength: false,
      kind: "polygons",
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

  // #472 — polygon choropleth dissolve routing.
  it("routes a polygons layer with a categorical colorBy to treatment 'dissolve'", () => {
    const agg = aggregationFromSpec({
      layers: [
        {
          kind: "polygons",
          source: { geometryColumn: "geom" },
          style: { colorBy: { column: "c_zip" } },
        },
      ],
    });
    expect(agg).toMatchObject({
      treatment: "dissolve",
      enabled: true,
      colorByColumn: "c_zip",
      kind: "polygons",
    });
  });

  it("keeps a polygons layer with a continuous (step) colorBy on 'bins'", () => {
    const agg = aggregationFromSpec({
      layers: [
        {
          kind: "polygons",
          source: { geometryColumn: "geom" },
          style: { colorBy: { column: "c_value", scale: "step" } },
        },
      ],
    });
    expect(agg.treatment).toBe("bins");
  });

  it("keeps a polygons layer with no colorBy on 'bins'", () => {
    const agg = aggregationFromSpec({
      layers: [{ kind: "polygons", source: { geometryColumn: "geom" } }],
    });
    expect(agg.treatment).toBe("bins");
  });

  it("shouldAggregate honours enabled + the zoom threshold", () => {
    const on = {
      enabled: true,
      zoomThreshold: 12,
      gridSizePx: 24,
      colorByColumn: null,
      kind: null,
      rankByLength: false,
      treatment: "bins" as const,
    };
    expect(shouldAggregate(11, on)).toBe(true);
    expect(shouldAggregate(12, on)).toBe(false); // threshold is exclusive
    expect(shouldAggregate(5, { ...on, enabled: false })).toBe(false);
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

describe("buildDissolveTileSql — polygon choropleth (#472)", () => {
  const agg = {
    enabled: true,
    zoomThreshold: 14,
    gridSizePx: 24,
    colorByColumn: "c_zip",
    kind: "polygons" as const,
    rankByLength: false,
    treatment: "dissolve" as const,
  };
  const q = () =>
    PortalMapTileService.buildDissolveTileSql(
      "SELECT geom, c_zip FROM parcels",
      8,
      "ST_TileEnvelope(8, 48, 96)",
      agg,
      MAP_TILE_FEATURE_CAP
    );

  it("groups by the colorBy column and collects simplified geometry", () => {
    const sql = q();
    expect(sql).toContain("GROUP BY");
    expect(sql).toContain("ST_Collect");
    expect(sql).toContain("ST_SimplifyPreserveTopology");
    expect(sql).toContain("ST_AsMVTGeom");
    // The colorBy column is both the group key and an emitted feature property.
    expect(sql).toContain('"c_zip"');
    expect(sql).toContain(`LIMIT ${MAP_TILE_FEATURE_CAP}`);
  });

  it("group + collect sit inside the capped CTE (before the outer MVT select)", () => {
    const sql = q();
    expect(sql.indexOf("GROUP BY")).toBeLessThan(sql.indexOf("ST_AsMVT("));
    expect(sql.indexOf("ST_Collect")).toBeLessThan(sql.indexOf("LIMIT"));
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
    expect(res.etag).toMatch(/^"[0-9a-f]{32}"$/);
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
    expect(res.etag).toMatch(/^"[0-9a-f]{32}"$/);
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
