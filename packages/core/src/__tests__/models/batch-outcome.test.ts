import {
  classifyBatchOutcome,
  BatchOutcomeFieldsSchema,
} from "../../models/batch-outcome.util.js";
import {
  BulkGeocodeResultSchema,
  BulkTransformResultSchema,
} from "../../models/job.model.js";

/**
 * #410 — a `bulk_geocode` job that geocoded 0 of 10 rows reported
 * `Completed`, because a processor's terminal status reflected "the loop did
 * not throw" rather than the outcome. `bulk_transform` had the same defect.
 * This classifier is the single place that decides, applied at the worker.
 */
describe("classifyBatchOutcome (#410)", () => {
  it("fails a batch where nothing succeeded and something failed", () => {
    // The case that hid app-dev's geocoding outage indefinitely.
    expect(
      classifyBatchOutcome({ recordsSucceeded: 0, recordsFailed: 10 })
    ).toBe("failed");
  });

  it("completes a partial failure", () => {
    // Deliberate: some addresses legitimately do not resolve, so a partial
    // failure IS a completed job. Treating it as failure would be its own
    // false alarm — that is why the rule is not `recordsFailed > 0`.
    expect(
      classifyBatchOutcome({ recordsSucceeded: 8, recordsFailed: 2 })
    ).toBe("completed");
  });

  it("completes a fully successful batch", () => {
    expect(
      classifyBatchOutcome({ recordsSucceeded: 5, recordsFailed: 0 })
    ).toBe("completed");
  });

  it("completes an empty batch", () => {
    // Nothing attempted is not a failure — a filter that matched no rows must
    // not surface as a broken job.
    expect(
      classifyBatchOutcome({ recordsSucceeded: 0, recordsFailed: 0 })
    ).toBe("completed");
  });

  it("completes a legacy result that predates recordsSucceeded", () => {
    // `recordsSucceeded` is optional precisely so historical `jobs.result`
    // rows stay parseable and need no backfill. Absence means "cannot tell",
    // which must classify as completed — never invent a failure for a job
    // that already reported success months ago.
    expect(
      classifyBatchOutcome({ recordsProcessed: 10, recordsFailed: 10 })
    ).toBe("completed");
  });

  it("leaves non-batch results alone", () => {
    // Seven of the nine job types are all-or-nothing and carry no per-item
    // accounting. They must be untouched by this change.
    expect(classifyBatchOutcome({ entitiesSynced: 3 })).toBe("completed");
    expect(classifyBatchOutcome({})).toBe("completed");
    expect(classifyBatchOutcome(null)).toBe("completed");
    expect(classifyBatchOutcome(undefined)).toBe("completed");
  });

  it("ignores a non-numeric recordsSucceeded rather than throwing", () => {
    // The worker hands this whatever a processor returned. A malformed result
    // must not take the worker down — the job's own result is already
    // persisted by then.
    expect(
      classifyBatchOutcome({ recordsSucceeded: "0", recordsFailed: 10 })
    ).toBe("completed");
  });
});

describe("BatchOutcomeFieldsSchema (#410)", () => {
  it("accepts the accounting fields", () => {
    const parsed = BatchOutcomeFieldsSchema.parse({
      recordsProcessed: 10,
      recordsFailed: 2,
      recordsSucceeded: 8,
      partialFailuresOmitted: 0,
    });
    expect(parsed.recordsSucceeded).toBe(8);
  });

  it("treats recordsSucceeded as optional", () => {
    const parsed = BatchOutcomeFieldsSchema.parse({
      recordsProcessed: 10,
      recordsFailed: 2,
    });
    expect(parsed.recordsSucceeded).toBeUndefined();
  });

  it("rejects a negative count", () => {
    expect(() =>
      BatchOutcomeFieldsSchema.parse({
        recordsProcessed: 1,
        recordsFailed: 0,
        recordsSucceeded: -1,
      })
    ).toThrow();
  });
});

describe("both batch result schemas carry the shared fields (#410)", () => {
  it("BulkGeocodeResultSchema accepts recordsSucceeded", () => {
    const parsed = BulkGeocodeResultSchema.parse({
      recordsProcessed: 10,
      recordsFailed: 2,
      recordsSucceeded: 8,
      geocoded: 6,
      cached: 2,
      failed: 2,
      durationMs: 1655,
    });
    expect(parsed.recordsSucceeded).toBe(8);
  });

  it("BulkGeocodeResultSchema still parses a row without it", () => {
    // A production row written before this change.
    const parsed = BulkGeocodeResultSchema.parse({
      recordsProcessed: 10,
      recordsFailed: 10,
      geocoded: 0,
      cached: 0,
      failed: 10,
      durationMs: 513,
    });
    expect(parsed.recordsSucceeded).toBeUndefined();
  });

  it("BulkTransformResultSchema accepts recordsSucceeded", () => {
    const parsed = BulkTransformResultSchema.parse({
      recordsProcessed: 40,
      recordsFailed: 0,
      recordsSucceeded: 40,
      durationMs: 900,
    });
    expect(parsed.recordsSucceeded).toBe(40);
  });

  it("keeps each type's own partialFailures shape", () => {
    // The item shapes genuinely differ — transform carries
    // targetConnectorEntityId/column, geocode does not — so only the scalar
    // accounting is shared. Pinning this stops a future "tidy-up" from
    // flattening them into one array type.
    const transform = BulkTransformResultSchema.parse({
      recordsProcessed: 1,
      recordsFailed: 1,
      durationMs: 5,
      partialFailures: [
        {
          sourceKey: "r1",
          targetConnectorEntityId: "e1",
          column: "c1",
          error: { success: false, code: "X", message: "m" },
        },
      ],
    });
    expect(transform.partialFailures?.[0].column).toBe("c1");

    const geocode = BulkGeocodeResultSchema.parse({
      recordsProcessed: 1,
      recordsFailed: 1,
      geocoded: 0,
      cached: 0,
      failed: 1,
      durationMs: 5,
      partialFailures: [
        { sourceKey: "r1", error: { success: false, code: "X", message: "m" } },
      ],
    });
    expect(geocode.partialFailures?.[0].sourceKey).toBe("r1");
  });
});
