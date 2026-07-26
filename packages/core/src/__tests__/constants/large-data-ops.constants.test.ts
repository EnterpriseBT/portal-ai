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
});
