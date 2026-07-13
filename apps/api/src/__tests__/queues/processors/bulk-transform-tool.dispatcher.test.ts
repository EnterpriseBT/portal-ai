import { describe, it, expect, jest } from "@jest/globals";

import { dispatchBatch } from "../../../queues/processors/bulk-transform-tool.dispatcher.js";

describe("dispatchBatch (Phase 4 slice 0)", () => {
  it("fans out per-record calls + collects successes by sourceKey", async () => {
    const tool = jest.fn(async (input: { sourceKey: string }) => ({
      doubled: input.sourceKey.length * 2,
    }));

    const result = await dispatchBatch({
      toolMetadata: {
        maxConcurrency: 4,
        timeoutMs: 5_000,
        idempotent: true,
      },
      keyField: "sourceKey",
      batch: [{ sourceKey: "a" }, { sourceKey: "bb" }, { sourceKey: "ccc" }],
      toolExecutor: tool as never,
    });

    expect(result.successes).toHaveLength(3);
    expect(result.failures).toHaveLength(0);
    expect(
      result.successes.map((s) => ({ key: s.sourceKey, value: s.value }))
    ).toEqual([
      { key: "a", value: { doubled: 2 } },
      { key: "bb", value: { doubled: 4 } },
      { key: "ccc", value: { doubled: 6 } },
    ]);
  });

  it("times out a stuck call → failure with BULK_DISPATCH_CALL_TIMEOUT", async () => {
    const tool = jest.fn(() => new Promise(() => {}));

    const result = await dispatchBatch({
      toolMetadata: { maxConcurrency: 1, timeoutMs: 50, idempotent: true },
      keyField: "sourceKey",
      batch: [{ sourceKey: "stuck" }],
      toolExecutor: tool as never,
    });

    expect(result.successes).toHaveLength(0);
    expect(result.failures).toHaveLength(1);
    expect(result.failures[0].sourceKey).toBe("stuck");
    expect(result.failures[0].error.code).toBe("BULK_DISPATCH_CALL_TIMEOUT");
  }, 5_000);

  it("collects per-record failures when the tool throws", async () => {
    let i = 0;
    const tool = jest.fn(async () => {
      i++;
      if (i === 2) throw new Error("hospital API returned 500");
      return { ok: true };
    });

    const result = await dispatchBatch({
      toolMetadata: { maxConcurrency: 1, timeoutMs: 1_000, idempotent: true },
      keyField: "sourceKey",
      batch: [{ sourceKey: "a" }, { sourceKey: "b" }, { sourceKey: "c" }],
      toolExecutor: tool as never,
    });

    expect(result.successes).toHaveLength(2);
    expect(result.failures).toHaveLength(1);
    expect(result.failures[0].sourceKey).toBe("b");
    expect(result.failures[0].error.message).toContain("hospital API");
  });

  it("respects maxConcurrency", async () => {
    let inFlight = 0;
    let maxObserved = 0;
    const tool = jest.fn(async () => {
      inFlight++;
      maxObserved = Math.max(maxObserved, inFlight);
      await new Promise((r) => setTimeout(r, 20));
      inFlight--;
      return { ok: true };
    });

    await dispatchBatch({
      toolMetadata: { maxConcurrency: 3, timeoutMs: 1_000, idempotent: true },
      keyField: "sourceKey",
      batch: Array.from({ length: 10 }, (_, k) => ({ sourceKey: `k-${k}` })),
      toolExecutor: tool as never,
    });

    expect(maxObserved).toBeLessThanOrEqual(3);
    expect(maxObserved).toBeGreaterThanOrEqual(1);
  }, 5_000);

  it("spreads the source row at the top level of the tool input + adds sourceKey/sourceRow helpers", async () => {
    // Tools declare their parameterSchema against source-row columns
    // and expect them at the top of `input`. The dispatcher must
    // spread the row directly, not nest it.
    let captured: unknown = null;
    const tool = jest.fn(async (input: unknown) => {
      captured = input;
      return { ok: true };
    });

    await dispatchBatch({
      toolMetadata: { maxConcurrency: 1, timeoutMs: 1_000, idempotent: true },
      staticArgs: { radius_km: 50 },
      keyField: "c_id",
      batch: [
        {
          c_id: "p-1",
          c_diameter_km_min: 0.02,
          c_diameter_km_max: 0.05,
        },
      ],
      toolExecutor: tool as never,
    });

    expect(captured).toEqual({
      radius_km: 50,
      c_id: "p-1",
      c_diameter_km_min: 0.02,
      c_diameter_km_max: 0.05,
      sourceKey: "p-1",
      sourceRow: {
        c_id: "p-1",
        c_diameter_km_min: 0.02,
        c_diameter_km_max: 0.05,
      },
    });
  });

  it("lets row columns win over staticArgs with the same key (agent footgun guard)", async () => {
    // The user's smoke walk surfaced this: the agent passed
    // `{c_id: "c_id", c_diameter_km_min: "c_diameter_km_min", ...}`
    // as expression.args, thinking they were field-name mappings.
    // The dispatcher must NOT let those literal strings clobber the
    // real row values.
    let captured: unknown = null;
    const tool = jest.fn(async (input: unknown) => {
      captured = input;
      return { ok: true };
    });

    await dispatchBatch({
      toolMetadata: { maxConcurrency: 1, timeoutMs: 1_000, idempotent: true },
      staticArgs: {
        c_id: "c_id",
        c_diameter_km_min: "c_diameter_km_min",
      },
      keyField: "c_id",
      batch: [{ c_id: "real-id-42", c_diameter_km_min: 0.02 }],
      toolExecutor: tool as never,
    });

    expect(captured).toMatchObject({
      c_id: "real-id-42",
      c_diameter_km_min: 0.02,
    });
  });
});
