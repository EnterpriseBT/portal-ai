/**
 * PortalResultPinService.materialize (#312): per-type validation + the
 * self-contained snapshot a pin persists. All deps injected — no Redis, no DB.
 */
import { jest, describe, it, expect } from "@jest/globals";
import { PIN_SNAPSHOT_ROW_CAP } from "@portalai/core/constants";

import { PortalResultPinService } from "../../services/portal-result-pin.service.js";
import type { MaterializeDeps } from "../../services/portal-result-pin.service.js";
import { ApiError } from "../../services/http.service.js";
import { ApiCode } from "../../constants/api-codes.constants.js";

const SCOPE = { stationId: "station-1", organizationId: "org-1" };

const expiredError = () =>
  new ApiError(404, ApiCode.READ_HANDLE_EXPIRED, "expired");

/** A live-handle snapshot reader returning `total` rows (capped by limit). */
const fakeSnapshot = (total: number) =>
  jest.fn(async (_id: string, range: { offset?: number; limit?: number }) => {
    const limit = range.limit ?? total;
    const n = Math.min(total, limit);
    return {
      rows: Array.from({ length: n }, (_, i) => ({ a: i })),
      total,
      offset: 0,
      limit,
    };
  });

describe("PortalResultPinService.materialize", () => {
  // ── text ────────────────────────────────────────────────────────────

  it("passes a text block through and stamps snapshotUpdatedAt", async () => {
    const before = Date.now();
    const result = await PortalResultPinService.materialize(
      "text",
      "## Total revenue: $1.2M",
      SCOPE
    );
    expect(result.content).toBe("## Total revenue: $1.2M");
    expect(result.snapshotUpdatedAt).toBeGreaterThanOrEqual(before);
  });

  it("rejects text content that is not a string", async () => {
    await expect(
      PortalResultPinService.materialize("text", { body: "x" }, SCOPE)
    ).rejects.toMatchObject({
      code: ApiCode.PORTAL_RESULT_TYPE_NOT_PINNABLE,
    });
  });

  // ── unregistered type ───────────────────────────────────────────────

  it("rejects a type with no registered content schema (geo pre-#84)", async () => {
    await expect(
      PortalResultPinService.materialize("geo", { layers: [] }, SCOPE)
    ).rejects.toMatchObject({
      code: ApiCode.PORTAL_RESULT_TYPE_NOT_PINNABLE,
    });
  });

  // ── inline content ──────────────────────────────────────────────────

  it("stores an inline data-table as-is with no derived pipeline", async () => {
    const result = await PortalResultPinService.materialize(
      "data-table",
      { columns: ["a"], rows: [{ a: 1 }] },
      SCOPE
    );
    expect(result.content).toEqual({ columns: ["a"], rows: [{ a: 1 }] });
  });

  it("stores an inline d3 block as-is, preserving its pipeline", async () => {
    const content = {
      program: "api.svg;",
      rows: [{ x: 1 }],
      pipeline: {
        sql: "SELECT x FROM t",
        stationId: "station-1",
        organizationId: "org-1",
      },
    };
    const result = await PortalResultPinService.materialize(
      "d3",
      content,
      SCOPE
    );
    expect(result.content).toEqual(content);
  });

  // ── handle-backed content, live handle ──────────────────────────────

  it("materializes a handle-backed data-table: rows ≤ cap, rowCount, truncated, derived pipeline", async () => {
    const getSnapshot = fakeSnapshot(PIN_SNAPSHOT_ROW_CAP + 500);
    const deps: MaterializeDeps = { getSnapshot: getSnapshot as never };
    const result = await PortalResultPinService.materialize(
      "data-table",
      {
        queryHandle: "qh-1",
        rowCount: PIN_SNAPSHOT_ROW_CAP + 500,
        schema: [{ name: "a", type: "number" }],
        sampled: false,
        truncated: false,
        samplePeek: [],
        sql: "SELECT a FROM t",
      },
      SCOPE,
      deps
    );
    const content = result.content as Record<string, unknown>;
    expect(getSnapshot).toHaveBeenCalledWith("qh-1", {
      offset: 0,
      limit: PIN_SNAPSHOT_ROW_CAP,
    });
    expect((content.rows as unknown[]).length).toBe(PIN_SNAPSHOT_ROW_CAP);
    expect(content.columns).toEqual(["a"]);
    expect(content.rowCount).toBe(PIN_SNAPSHOT_ROW_CAP + 500);
    expect(content.truncated).toBe(true);
    expect(content.pipeline).toEqual({
      sql: "SELECT a FROM t",
      stationId: "station-1",
      organizationId: "org-1",
    });
    // The ephemeral envelope never persists.
    expect(content.queryHandle).toBeUndefined();
  });

  it("derives no pipeline when the envelope's sql is null (produceFromRows)", async () => {
    const deps: MaterializeDeps = {
      getSnapshot: fakeSnapshot(3) as never,
      getMeta: jest.fn(async () => ({ sql: null })) as never,
    };
    const result = await PortalResultPinService.materialize(
      "data-table",
      {
        queryHandle: "qh-2",
        rowCount: 3,
        schema: [{ name: "a", type: "number" }],
        sampled: false,
        truncated: false,
        samplePeek: [],
        sql: null,
      },
      SCOPE,
      deps
    );
    const content = result.content as Record<string, unknown>;
    expect((content.rows as unknown[]).length).toBe(3);
    expect(content.truncated).toBe(false);
    expect(content.pipeline).toBeUndefined();
  });

  // #312 smoke find: the persisted display block omits the envelope's
  // retained sql — the server-side handle meta is the authoritative source.
  it("derives the pipeline from server-side handle meta when the block omits sql", async () => {
    const getMeta = jest.fn(async () => ({ sql: "SELECT a FROM t" }));
    const result = await PortalResultPinService.materialize(
      "data-table",
      {
        // The real block shape: no `sql`, no `truncated` (see portal.service
        // resolveDisplayBlock) — only what the client renderer needs.
        queryHandle: "qh-4",
        rowCount: 3,
        schema: [{ name: "a", type: "number" }],
        sampled: false,
        samplePeek: [],
      },
      SCOPE,
      { getSnapshot: fakeSnapshot(3) as never, getMeta: getMeta as never }
    );
    expect(getMeta).toHaveBeenCalledWith("qh-4");
    const content = result.content as Record<string, unknown>;
    expect(content.pipeline).toEqual({
      sql: "SELECT a FROM t",
      stationId: "station-1",
      organizationId: "org-1",
    });
  });

  it("stays a static snapshot when the meta read fails mid-pin", async () => {
    const getMeta = jest.fn(async () => {
      throw expiredError();
    });
    const result = await PortalResultPinService.materialize(
      "data-table",
      {
        queryHandle: "qh-5",
        rowCount: 3,
        schema: [{ name: "a", type: "number" }],
        sampled: false,
        samplePeek: [],
      },
      SCOPE,
      { getSnapshot: fakeSnapshot(3) as never, getMeta: getMeta as never }
    );
    const content = result.content as Record<string, unknown>;
    expect((content.rows as unknown[]).length).toBe(3);
    expect(content.pipeline).toBeUndefined();
  });

  it("keeps a handle-backed d3 block's own pipeline and strips the envelope", async () => {
    const deps: MaterializeDeps = { getSnapshot: fakeSnapshot(10) as never };
    const result = await PortalResultPinService.materialize(
      "d3",
      {
        program: "api.svg;",
        queryHandle: "qh-3",
        rowCount: 10,
        schema: [{ name: "x", type: "number" }],
        sampled: false,
        truncated: false,
        samplePeek: [],
        sql: "SELECT x FROM t",
        pipeline: {
          sql: "SELECT x FROM t",
          stationId: "station-1",
          organizationId: "org-1",
        },
      },
      SCOPE,
      deps
    );
    const content = result.content as Record<string, unknown>;
    expect(content.program).toBe("api.svg;");
    expect((content.rows as unknown[]).length).toBe(10);
    expect(content.pipeline).toBeDefined();
    expect(content.queryHandle).toBeUndefined();
  });

  // ── geo pins: WKB → GeoJSON re-encode (#371) ────────────────────────

  const geoSpec = {
    layers: [{ kind: "polygons", source: { geometryColumn: "geom" } }],
  };

  it("re-encodes a handle-backed geo pin's WKB geometry to GeoJSON", async () => {
    const wkbRows = [
      { geom: "0101000020E610000000000000000000000000000000000000", c_id: 1 },
      { geom: "0101000020E610000000000000000000000000000000000000", c_id: 2 },
    ];
    const geoReencodeRows = jest.fn(
      async (rows: Array<Record<string, unknown>>) =>
        rows.map((r) => ({
          ...r,
          geom: { type: "Point", coordinates: [0, 0] },
        }))
    );
    const result = await PortalResultPinService.materialize(
      "geo",
      {
        queryHandle: "qh-geo",
        spec: geoSpec,
        rows: [],
        sql: "SELECT geom, c_id FROM parcels",
      },
      SCOPE,
      {
        getSnapshot: jest.fn(async () => ({
          rows: wkbRows,
          total: 2,
          offset: 0,
          limit: PIN_SNAPSHOT_ROW_CAP,
        })) as never,
        geoReencodeRows: geoReencodeRows as never,
      }
    );
    // Re-encode ran over the snapshot rows for the spec's geometry column.
    expect(geoReencodeRows).toHaveBeenCalledWith(wkbRows, ["geom"]);
    const content = result.content as Record<string, unknown>;
    expect(content.rows).toEqual([
      { geom: { type: "Point", coordinates: [0, 0] }, c_id: 1 },
      { geom: { type: "Point", coordinates: [0, 0] }, c_id: 2 },
    ]);
    // Snapshot held every row (total 2 = rows 2), so it is not tile-backed.
    expect(content.tiled).toBeUndefined();
  });

  // #371: a geo pin whose source outran the inline snapshot is marked `tiled`
  // so the widget renders the full dataset via the pin's tile endpoint on mount.
  it("marks a truncated, refreshable geo pin as tiled", async () => {
    const geoReencodeRows = jest.fn(
      async (rows: Array<Record<string, unknown>>) =>
        rows.map((r) => ({
          ...r,
          geom: { type: "Point", coordinates: [0, 0] },
        }))
    );
    const result = await PortalResultPinService.materialize(
      "geo",
      {
        queryHandle: "qh-geo-big",
        spec: geoSpec,
        rows: [],
        sql: "SELECT geom FROM parcels",
      },
      SCOPE,
      {
        getSnapshot: jest.fn(async () => ({
          rows: [
            { geom: "0101000020E610000000000000000000000000000000000000" },
          ],
          total: 100_001,
          offset: 0,
          limit: PIN_SNAPSHOT_ROW_CAP,
        })) as never,
        geoReencodeRows: geoReencodeRows as never,
      }
    );
    const content = result.content as Record<string, unknown>;
    expect(content.tiled).toBe(true);
    // The inline rows persist as a fallback even when tile-backed.
    expect((content.rows as unknown[]).length).toBe(1);
  });

  it("does not mark a truncated geo pin tiled when it has no pipeline", async () => {
    const result = await PortalResultPinService.materialize(
      "geo",
      // No `sql` and no `pipeline` on the block → not refreshable.
      { queryHandle: "qh-geo-static", spec: geoSpec, rows: [] },
      SCOPE,
      {
        getSnapshot: jest.fn(async () => ({
          rows: [
            { geom: "0101000020E610000000000000000000000000000000000000" },
          ],
          total: 100_001,
          offset: 0,
          limit: PIN_SNAPSHOT_ROW_CAP,
        })) as never,
        // Meta read yields no sql → pipeline stays undefined → static snapshot.
        getMeta: jest.fn(async () => ({})) as never,
        geoReencodeRows: (async (rows: Array<Record<string, unknown>>) =>
          rows.map((r) => ({
            ...r,
            geom: { type: "Point", coordinates: [0, 0] },
          }))) as never,
      }
    );
    const content = result.content as Record<string, unknown>;
    expect(content.tiled).toBeUndefined();
  });

  it("does not re-encode a non-geo (data-table) pin", async () => {
    const geoReencodeRows = jest.fn(
      async (rows: Array<Record<string, unknown>>) => rows
    );
    await PortalResultPinService.materialize(
      "data-table",
      {
        queryHandle: "qh-dt",
        rowCount: 2,
        schema: [{ name: "a", type: "number" }],
        sampled: false,
        truncated: false,
        samplePeek: [],
        sql: "SELECT a FROM t",
      },
      SCOPE,
      {
        getSnapshot: fakeSnapshot(2) as never,
        geoReencodeRows: geoReencodeRows as never,
      }
    );
    expect(geoReencodeRows).not.toHaveBeenCalled();
  });

  it("materializes a geo pin with no rows without calling the re-encoder", async () => {
    const geoReencodeRows = jest.fn(
      async (rows: Array<Record<string, unknown>>) => rows
    );
    const result = await PortalResultPinService.materialize(
      "geo",
      {
        queryHandle: "qh-geo-empty",
        spec: geoSpec,
        rows: [],
        sql: "SELECT geom FROM t",
      },
      SCOPE,
      {
        getSnapshot: jest.fn(async () => ({
          rows: [],
          total: 0,
          offset: 0,
          limit: PIN_SNAPSHOT_ROW_CAP,
        })) as never,
        geoReencodeRows: geoReencodeRows as never,
      }
    );
    expect(geoReencodeRows).not.toHaveBeenCalled();
    expect((result.content as Record<string, unknown>).rows).toEqual([]);
  });

  // ── handle-backed content, expired handle ───────────────────────────

  it("re-executes the pipeline when the handle has expired", async () => {
    const getSnapshot = jest.fn(async () => {
      throw expiredError();
    });
    const resolveSqlDelivery = jest.fn(async () => ({
      kind: "inline" as const,
      result: { rows: [{ a: 1 }, { a: 2 }] },
    }));
    const result = await PortalResultPinService.materialize(
      "data-table",
      {
        queryHandle: "qh-dead",
        rowCount: 2,
        schema: [{ name: "a", type: "number" }],
        sampled: false,
        truncated: false,
        samplePeek: [],
        sql: "SELECT a FROM t",
      },
      SCOPE,
      {
        getSnapshot: getSnapshot as never,
        resolveSqlDelivery: resolveSqlDelivery as never,
      }
    );
    expect(resolveSqlDelivery).toHaveBeenCalledWith(
      { sql: "SELECT a FROM t" },
      { stationId: "station-1", organizationId: "org-1" }
    );
    const content = result.content as Record<string, unknown>;
    expect(content.rows).toEqual([{ a: 1 }, { a: 2 }]);
    expect(content.pipeline).toBeDefined();
  });

  it("throws 422 PORTAL_RESULT_CONTENT_EXPIRED when expired with no pipeline", async () => {
    const getSnapshot = jest.fn(async () => {
      throw expiredError();
    });
    await expect(
      PortalResultPinService.materialize(
        "data-table",
        {
          queryHandle: "qh-dead",
          rowCount: 2,
          schema: [{ name: "a", type: "number" }],
          sampled: false,
          truncated: false,
          samplePeek: [],
          sql: null,
        },
        SCOPE,
        { getSnapshot: getSnapshot as never }
      )
    ).rejects.toMatchObject({
      status: 422,
      code: ApiCode.PORTAL_RESULT_CONTENT_EXPIRED,
    });
  });
});
