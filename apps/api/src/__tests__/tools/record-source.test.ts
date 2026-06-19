import { jest, describe, it, expect, beforeEach } from "@jest/globals";

import { COMPUTE_MAX_ROWS } from "@portalai/core/constants";
import type { Consumption } from "@portalai/core/models";

import { ApiCode } from "../../constants/api-codes.constants.js";

// Mock the handle service — the only I/O the resolver performs.
const mockGetSnapshot = jest.fn<() => Promise<unknown>>();
const mockGetMeta = jest.fn<() => Promise<unknown>>();
const mockStreamHandle = jest.fn();
jest.unstable_mockModule("../../services/portal-sql-handle.service.js", () => ({
  PortalSqlHandleService: {
    getSnapshot: mockGetSnapshot,
    getMeta: mockGetMeta,
    streamHandle: mockStreamHandle,
  },
  // pure helper — mirror the real resolution (`_record_id` or `id`).
  resolveTiebreaker: (schema: Array<{ name: string }>) =>
    schema.find((c) => c.name === "_record_id" || c.name === "id")?.name ??
    null,
}));

const { resolveRecordSource, resolveRecordStream } = await import(
  "../../tools/record-source.js"
);

const rowsOf = (n: number) => Array.from({ length: n }, (_, i) => ({ i }));

async function collect<T>(gen: AsyncGenerator<T>): Promise<T[]> {
  const out: T[] = [];
  for await (const x of gen) out.push(x);
  return out;
}
async function* genOf(...batches: unknown[][]) {
  for (const b of batches) yield b;
}

describe("resolveRecordSource — consumption as a ceiling", () => {
  beforeEach(() => {
    mockGetSnapshot.mockReset();
  });

  it.each<[string, Consumption]>([
    ["streaming", { mode: "streaming" }],
    ["engine-pushdown", { mode: "engine-pushdown" }],
    ["none", { mode: "none" }],
    ["bounded", { mode: "bounded", maxRows: COMPUTE_MAX_ROWS, onOverflow: "error" }],
  ])(
    "delivers small inline data in-memory regardless of mode (%s)",
    async (_label, consumption) => {
      const rows = rowsOf(10);
      const res = await resolveRecordSource({ rows }, consumption);
      expect(res).toEqual({ rows, total: 10, sampled: false });
      expect(mockGetSnapshot).not.toHaveBeenCalled();
    }
  );

  it("delivers a ≤cap handle snapshot, no sampling", async () => {
    const rows = rowsOf(3);
    mockGetSnapshot.mockResolvedValue({ rows, total: 3, offset: 0, limit: 100 });
    const res = await resolveRecordSource(
      { queryHandle: "qh-1" },
      { mode: "streaming" }
    );
    expect(res).toEqual({ rows, total: 3, sampled: false });
  });
});

describe("resolveRecordSource — bounded onOverflow", () => {
  beforeEach(() => {
    mockGetSnapshot.mockReset();
  });

  const bounded = (onOverflow: "error" | "sample" | "stream" | "decompose"): Consumption => ({
    mode: "bounded",
    maxRows: 100,
    onOverflow,
  });

  it("error: throws COMPUTE_INPUT_TOO_LARGE for inline rows over the bound", async () => {
    await expect(
      resolveRecordSource({ rows: rowsOf(101) }, bounded("error"))
    ).rejects.toMatchObject({ code: ApiCode.COMPUTE_INPUT_TOO_LARGE });
  });

  it("sample: systematically samples inline rows down to the bound, flagged", async () => {
    const res = await resolveRecordSource({ rows: rowsOf(1000) }, bounded("sample"));
    expect(res.sampled).toBe(true);
    expect(res.total).toBe(1000);
    expect(res.rows.length).toBeLessThanOrEqual(100);
    expect(res.rows.length).toBeGreaterThan(0);
    // deterministic stride sample → first element preserved
    expect(res.rows[0]).toEqual({ i: 0 });
  });

  it("stream/decompose: not yet serviceable in-memory (ships in #129)", async () => {
    await expect(
      resolveRecordSource({ rows: rowsOf(101) }, bounded("stream"))
    ).rejects.toMatchObject({ code: ApiCode.COMPUTE_INPUT_TOO_LARGE });
    await expect(
      resolveRecordSource({ rows: rowsOf(101) }, bounded("decompose"))
    ).rejects.toMatchObject({ code: ApiCode.COMPUTE_INPUT_TOO_LARGE });
  });
});

describe("resolveRecordSource — handle over the bound", () => {
  beforeEach(() => {
    mockGetSnapshot.mockReset();
  });

  it("error: throws when the handle's true total exceeds the cap", async () => {
    mockGetSnapshot.mockResolvedValue({
      rows: rowsOf(100),
      total: 500,
      offset: 0,
      limit: 100,
    });
    await expect(
      resolveRecordSource(
        { queryHandle: "qh-big" },
        { mode: "bounded", maxRows: 100, onOverflow: "error" }
      )
    ).rejects.toMatchObject({ code: ApiCode.COMPUTE_INPUT_TOO_LARGE });
  });

  it("sample over a handle is deferred to the cursor work (#129)", async () => {
    mockGetSnapshot.mockResolvedValue({
      rows: rowsOf(100),
      total: 500,
      offset: 0,
      limit: 100,
    });
    await expect(
      resolveRecordSource(
        { queryHandle: "qh-big" },
        { mode: "bounded", maxRows: 100, onOverflow: "sample" }
      )
    ).rejects.toMatchObject({ code: ApiCode.COMPUTE_INPUT_TOO_LARGE });
  });
});

describe("resolveRecordStream — streaming consumption (#129)", () => {
  beforeEach(() => {
    mockGetSnapshot.mockReset();
    mockGetMeta.mockReset();
    mockStreamHandle.mockReset();
  });

  const streaming: Consumption = { mode: "streaming" };

  it("inline rows yield as a single batch (no handle I/O)", async () => {
    const rows = rowsOf(3);
    const out = await collect(resolveRecordStream({ rows }, streaming, {}));
    expect(out).toEqual([rows]);
    expect(mockGetMeta).not.toHaveBeenCalled();
  });

  it("orders inline rows by orderBy (folds need ordered input)", async () => {
    const rows = [{ ts: 3 }, { ts: 1 }, { ts: 2 }];
    const out = await collect(
      resolveRecordStream({ rows }, streaming, { orderBy: "ts" })
    );
    expect(out).toEqual([[{ ts: 1 }, { ts: 2 }, { ts: 3 }]]);
  });

  it("orders ISO-timestamp inline rows chronologically", async () => {
    const rows = [
      { ts: "2020-03-01T00:00:00.000Z" },
      { ts: "2020-01-01T00:00:00.000Z" },
      { ts: "2020-02-01T00:00:00.000Z" },
    ];
    const out = await collect(
      resolveRecordStream({ rows }, streaming, { orderBy: "ts" })
    );
    expect(out[0].map((r) => r.ts)).toEqual([
      "2020-01-01T00:00:00.000Z",
      "2020-02-01T00:00:00.000Z",
      "2020-03-01T00:00:00.000Z",
    ]);
  });

  it("orders the bounded fallback batch by orderBy too", async () => {
    mockGetMeta.mockResolvedValue({ schema: [{ name: "ts" }] }); // no id → fallback
    mockGetSnapshot.mockResolvedValue({
      rows: [{ ts: 3 }, { ts: 1 }, { ts: 2 }],
      total: 3,
      offset: 0,
      limit: COMPUTE_MAX_ROWS,
    });
    const out = await collect(
      resolveRecordStream({ queryHandle: "qh" }, streaming, { orderBy: "ts" })
    );
    expect(out).toEqual([[{ ts: 1 }, { ts: 2 }, { ts: 3 }]]);
    expect(mockStreamHandle).not.toHaveBeenCalled();
  });

  it("delegates to streamHandle when orderBy + an id tiebreaker resolve", async () => {
    mockGetMeta.mockResolvedValue({
      schema: [{ name: "id" }, { name: "ts" }],
    });
    mockStreamHandle.mockReturnValue(genOf([{ ts: 1 }], [{ ts: 2 }]));
    const out = await collect(
      resolveRecordStream({ queryHandle: "qh" }, streaming, { orderBy: "ts" })
    );
    expect(out).toEqual([[{ ts: 1 }], [{ ts: 2 }]]);
    expect(mockStreamHandle).toHaveBeenCalledWith("qh", "ts");
    expect(mockGetSnapshot).not.toHaveBeenCalled();
  });

  it("falls back to the bounded tier when there is no id tiebreaker", async () => {
    mockGetMeta.mockResolvedValue({ schema: [{ name: "ts" }] }); // no id
    mockGetSnapshot.mockResolvedValue({
      rows: [{ ts: 1 }],
      total: 1,
      offset: 0,
      limit: COMPUTE_MAX_ROWS,
    });
    const out = await collect(
      resolveRecordStream({ queryHandle: "qh" }, streaming, { orderBy: "ts" })
    );
    expect(out).toEqual([[{ ts: 1 }]]);
    expect(mockStreamHandle).not.toHaveBeenCalled();
    expect(mockGetSnapshot).toHaveBeenCalled();
  });

  it("falls back when no orderBy is declared, even with an id", async () => {
    mockGetMeta.mockResolvedValue({
      schema: [{ name: "id" }, { name: "ts" }],
    });
    mockGetSnapshot.mockResolvedValue({
      rows: [{ id: 1 }],
      total: 1,
      offset: 0,
      limit: COMPUTE_MAX_ROWS,
    });
    const out = await collect(
      resolveRecordStream({ queryHandle: "qh" }, streaming, {})
    );
    expect(out).toEqual([[{ id: 1 }]]);
    expect(mockStreamHandle).not.toHaveBeenCalled();
  });
});
