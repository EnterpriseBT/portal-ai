import { describe, it, expect } from "@jest/globals";

import {
  PortalMapTileService,
  MAP_TILE_FEATURE_CAP,
  propertyColumnsFromSpec,
  tileSimplifyTolerance,
  aggregationFromSpec,
  shouldAggregate,
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

  it("shouldAggregate honours enabled + the zoom threshold", () => {
    const on = {
      enabled: true,
      zoomThreshold: 12,
      gridSizePx: 24,
      colorByColumn: null,
    };
    expect(shouldAggregate(11, on)).toBe(true);
    expect(shouldAggregate(12, on)).toBe(false); // threshold is exclusive
    expect(shouldAggregate(5, { ...on, enabled: false })).toBe(false);
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
