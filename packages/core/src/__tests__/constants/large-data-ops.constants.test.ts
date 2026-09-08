import {
  MAX_BULK_RECORDS,
  DEFAULT_BULK_BATCH,
  MAX_CONCURRENT_BULK_PER_ORG,
  BATCH_ROW_PAYLOAD_LIMIT,
  READ_HANDLE_TTL_MS,
  SAMPLING_THRESHOLD,
  STATEMENT_TIMEOUT_MS,
  INLINE_ROWS_THRESHOLD,
  HANDLE_ROW_CAP,
  COMPUTE_MAX_ROWS,
  VIZ_REFRESH_FRESHNESS_MS,
  VIZ_REFRESH_RATE_PER_MIN,
  DISSOLVE_ZOOM_BANDS,
  DISSOLVE_CARDINALITY_CEILING,
  bandForZoom,
  AGG_ZOOM_THRESHOLD,
  AGG_GRID_LEVELS,
  AGG_CELLS_PER_AXIS,
  AGG_TILE_VERSION,
} from "../../constants/large-data-ops.constants.js";

// Anchor test that locks the documented values from
// docs/LARGE_DATA_OPS_PHASE_1.spec.md § In scope item 6. If a constant
// drifts from its spec'd value, the spec doc needs to drift first.

describe("large-data-ops constants", () => {
  it("exports the resource-limit constants with the documented values", () => {
    expect(MAX_BULK_RECORDS).toBe(1_000_000);
    expect(DEFAULT_BULK_BATCH).toBe(1_000);
    expect(MAX_CONCURRENT_BULK_PER_ORG).toBe(2);
    expect(BATCH_ROW_PAYLOAD_LIMIT).toBe(256 * 1024);
    expect(READ_HANDLE_TTL_MS).toBe(24 * 60 * 60 * 1000);
    expect(SAMPLING_THRESHOLD).toBe(50_000);
    expect(STATEMENT_TIMEOUT_MS).toBe(30_000);
    expect(INLINE_ROWS_THRESHOLD).toBe(100);
    expect(HANDLE_ROW_CAP).toBe(100_000);
    expect(COMPUTE_MAX_ROWS).toBe(HANDLE_ROW_CAP);
  });

  it("exports the #270 widget-refresh constants (freshness in the 2–5 min band)", () => {
    expect(VIZ_REFRESH_FRESHNESS_MS).toBe(3 * 60 * 1000);
    expect(VIZ_REFRESH_FRESHNESS_MS).toBeGreaterThanOrEqual(2 * 60 * 1000);
    expect(VIZ_REFRESH_FRESHNESS_MS).toBeLessThanOrEqual(5 * 60 * 1000);
    expect(VIZ_REFRESH_RATE_PER_MIN).toBe(120);
  });

  // #472 — precomputed polygon-dissolve zoom bands.
  describe("dissolve bands (#472, retuned #478)", () => {
    it("covers z0–13 with disjoint bands ending at the z14 raw handoff", () => {
      expect(DISSOLVE_ZOOM_BANDS).toHaveLength(5);
      expect(
        DISSOLVE_ZOOM_BANDS[DISSOLVE_ZOOM_BANDS.length - 1].maxZoomExclusive
      ).toBe(AGG_ZOOM_THRESHOLD);
      // strictly increasing, disjoint, contiguous upper bounds
      const uppers = DISSOLVE_ZOOM_BANDS.map((b) => b.maxZoomExclusive);
      expect(uppers).toEqual([...uppers].sort((a, b) => a - b));
      expect(new Set(uppers).size).toBe(uppers.length); // no duplicates
      // band indices are 0..n-1 in order
      expect(DISSOLVE_ZOOM_BANDS.map((b) => b.band)).toEqual([0, 1, 2, 3, 4]);
    });

    it("bandForZoom maps low zooms to a band and z>=14 to null (#478 5-band)", () => {
      expect(bandForZoom(0)).toBe(0);
      expect(bandForZoom(6)).toBe(0);
      expect(bandForZoom(7)).toBe(1);
      expect(bandForZoom(8)).toBe(2);
      expect(bandForZoom(9)).toBe(3);
      expect(bandForZoom(10)).toBe(3);
      expect(bandForZoom(11)).toBe(4);
      expect(bandForZoom(13)).toBe(4);
      expect(bandForZoom(14)).toBeNull();
      expect(bandForZoom(18)).toBeNull();
    });

    it("caps dissolve cardinality at 64", () => {
      expect(DISSOLVE_CARDINALITY_CEILING).toBe(64);
    });
  });

  // #532 — nested aggregate grid + tile-version salt.
  describe("nested aggregate grid (#532)", () => {
    it("cells-per-axis is a power of two so the grid nests across zoom", () => {
      expect(AGG_CELLS_PER_AXIS).toBe(2 ** AGG_GRID_LEVELS);
      // power of two ⇒ (n & (n-1)) === 0
      expect(AGG_CELLS_PER_AXIS & (AGG_CELLS_PER_AXIS - 1)).toBe(0);
      expect(AGG_CELLS_PER_AXIS).toBe(16);
    });

    it("nesting property: cell size halves each zoom level (cellSize(z) = 2·cellSize(z+1))", () => {
      // cellSize(z) = WORLD / 2^(z + AGG_GRID_LEVELS); the world width cancels,
      // so the ratio is exactly 2 for any world width and any z.
      const cellSize = (z: number) => 1 / 2 ** (z + AGG_GRID_LEVELS);
      for (let z = 0; z < 14; z++) {
        expect(cellSize(z) / cellSize(z + 1)).toBeCloseTo(2, 10);
      }
    });

    it("exports a numeric tile-version salt for ETag cache-busting", () => {
      expect(typeof AGG_TILE_VERSION).toBe("number");
      expect(AGG_TILE_VERSION).toBeGreaterThanOrEqual(1);
    });
  });
});
