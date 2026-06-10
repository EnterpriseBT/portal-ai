import {
  MAX_BULK_RECORDS,
  DEFAULT_BULK_BATCH,
  MAX_CONCURRENT_BULK_PER_ORG,
  BATCH_ROW_PAYLOAD_LIMIT,
  READ_HANDLE_TTL_MS,
  SAMPLING_THRESHOLD,
  STATEMENT_TIMEOUT_MS,
  INLINE_ROWS_THRESHOLD,
} from "../../constants/large-data-ops.constants.js";

// Anchor test that locks the documented values from
// docs/LARGE_DATA_OPS_PHASE_1.spec.md § In scope item 6. If a constant
// drifts from its spec'd value, the spec doc needs to drift first.

describe("large-data-ops constants", () => {
  it("exports the eight resource-limit constants with the documented values", () => {
    expect(MAX_BULK_RECORDS).toBe(1_000_000);
    expect(DEFAULT_BULK_BATCH).toBe(1_000);
    expect(MAX_CONCURRENT_BULK_PER_ORG).toBe(2);
    expect(BATCH_ROW_PAYLOAD_LIMIT).toBe(256 * 1024);
    expect(READ_HANDLE_TTL_MS).toBe(24 * 60 * 60 * 1000);
    expect(SAMPLING_THRESHOLD).toBe(50_000);
    expect(STATEMENT_TIMEOUT_MS).toBe(30_000);
    expect(INLINE_ROWS_THRESHOLD).toBe(100);
  });
});
