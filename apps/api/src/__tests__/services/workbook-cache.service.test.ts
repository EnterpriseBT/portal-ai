import { jest, describe, it, expect, beforeEach } from "@jest/globals";

// Mock Redis with an in-memory Map so the cache logic is the only thing
// under test. Real Redis behavior is exercised through the integration
// suite via the file-upload + select-sheet routes.

const store = new Map<string, string>();

jest.unstable_mockModule("../../utils/redis.util.js", () => ({
  getRedisClient: () => ({
    async set(key: string, value: string, _ex: string, _ttl: number) {
      store.set(key, value);
      return "OK";
    },
    async get(key: string) {
      return store.get(key) ?? null;
    },
    async mget(...keys: string[]) {
      return keys.map((k) => store.get(k) ?? null);
    },
    async del(...keys: string[]) {
      let n = 0;
      for (const k of keys) {
        if (store.delete(k)) n++;
      }
      return n;
    },
    scanStream({ match }: { match: string; count?: number }) {
      // Tiny async iterable that yields all matching keys in a single batch.
      // ioredis' real scanStream paginates via SCAN cursors; for test
      // purposes a one-shot batch is enough — the consumer just collects
      // every yielded key.
      const re = new RegExp(
        "^" +
          match
            .split("*")
            .map((p) => p.replace(/[.+?^${}()|[\]\\]/g, "\\$&"))
            .join(".*") +
          "$"
      );
      const matched = [...store.keys()].filter((k) => re.test(k));
      return (async function* () {
        if (matched.length > 0) yield matched;
      })();
    },
  }),
}));

const { WorkbookCacheService } = await import(
  "../../services/workbook-cache.service.js"
);

import type { ChunkRow } from "../../services/workbook-cache.service.js";

// The legacy single-blob `set` / `get` / `delete(cacheKey, WorkbookData)` API
// was removed in Phase 4 of the streaming refactor (see
// docs/LARGE_FILE_PARSE_STREAMING.plan.md); tests below cover the chunked
// streaming layout that all three pipelines now use.

// ── Chunked streaming API ──────────────────────────────────────────────────

async function collect<T>(it: AsyncIterable<T>): Promise<T[]> {
  const out: T[] = [];
  for await (const v of it) out.push(v);
  return out;
}

describe("WorkbookCacheService — chunked streaming API", () => {
  beforeEach(() => {
    store.clear();
  });

  it("writes meta + row chunks + merges and round-trips through readRows", async () => {
    const writer = await WorkbookCacheService.beginSession("upload-session:abc");

    const rows: ChunkRow[] = [
      ["a", "b", "c"],
      ["1", "2", "3"],
      ["x", "y", "z"],
    ];
    await writer.appendRows("sheet_0_t", rows);
    await writer.finishSheet("sheet_0_t", {
      name: "T",
      rowCount: 3,
      colCount: 3,
      merges: [{ startRow: 1, startCol: 1, endRow: 1, endCol: 2 }],
    });
    await writer.finalize("ready");

    const meta = await WorkbookCacheService.getSessionMeta("upload-session:abc");
    expect(meta).not.toBeNull();
    expect(meta!.status).toBe("ready");
    expect(meta!.sheets).toHaveLength(1);
    expect(meta!.sheets[0]).toEqual({
      sheetId: "sheet_0_t",
      name: "T",
      rowCount: 3,
      colCount: 3,
      hasMerges: true,
    });

    const allRows = await collect(
      WorkbookCacheService.readRows("upload-session:abc", "sheet_0_t", 0, 3)
    );
    expect(allRows).toEqual(rows);

    const merges = await WorkbookCacheService.getMerges(
      "upload-session:abc",
      "sheet_0_t"
    );
    expect(merges).toEqual([
      { startRow: 1, startCol: 1, endRow: 1, endCol: 2 },
    ]);
  });

  it("buffers rows across appendRows calls and only emits a chunk when full", async () => {
    // Default ROWS_PER_CHUNK in the env is 1000; this test spans the boundary
    // by appending 1500 rows in two batches.
    const writer = await WorkbookCacheService.beginSession("upload-session:big");
    const make = (start: number, count: number): ChunkRow[] =>
      Array.from({ length: count }, (_, i) => [String(start + i)]);
    await writer.appendRows("s", make(0, 700));
    await writer.appendRows("s", make(700, 800));
    await writer.finishSheet("s", { name: "S", rowCount: 1500, colCount: 1 });
    await writer.finalize("ready");

    const head = await collect(
      WorkbookCacheService.readRows("upload-session:big", "s", 0, 5)
    );
    expect(head).toEqual([["0"], ["1"], ["2"], ["3"], ["4"]]);

    // Mid-range read crosses the chunk boundary at row 1000.
    const mid = await collect(
      WorkbookCacheService.readRows("upload-session:big", "s", 998, 1003)
    );
    expect(mid).toEqual([
      ["998"],
      ["999"],
      ["1000"],
      ["1001"],
      ["1002"],
    ]);
  });

  it("readRows pulls only the chunks that intersect the requested range", async () => {
    const writer = await WorkbookCacheService.beginSession("upload-session:r");
    const rows: ChunkRow[] = Array.from({ length: 2500 }, (_, i) => [
      String(i),
    ]);
    await writer.appendRows("s", rows);
    await writer.finishSheet("s", {
      name: "S",
      rowCount: 2500,
      colCount: 1,
    });
    await writer.finalize("ready");

    // chunk size 1000 → row 1500 lives in chunk 1 (rows 1000..1999)
    const slice = await collect(
      WorkbookCacheService.readRows("upload-session:r", "s", 1500, 1503)
    );
    expect(slice).toEqual([["1500"], ["1501"], ["1502"]]);
  });

  it("returns null meta for an unknown session", async () => {
    expect(
      await WorkbookCacheService.getSessionMeta("upload-session:nope")
    ).toBeNull();
  });

  it("getMerges returns an empty array when no merges were written", async () => {
    const writer = await WorkbookCacheService.beginSession("upload-session:nm");
    await writer.appendRows("s", [["a"]]);
    await writer.finishSheet("s", { name: "S", rowCount: 1, colCount: 1 });
    await writer.finalize("ready");
    expect(
      await WorkbookCacheService.getMerges("upload-session:nm", "s")
    ).toEqual([]);
  });

  it("fail() marks the session failed without losing already-written chunks", async () => {
    const writer = await WorkbookCacheService.beginSession("upload-session:f");
    await writer.appendRows("s", [["a"], ["b"]]);
    await writer.finishSheet("s", { name: "S", rowCount: 2, colCount: 1 });
    await writer.fail("simulated parse failure");

    const meta = await WorkbookCacheService.getSessionMeta("upload-session:f");
    expect(meta?.status).toBe("failed");
    expect(meta?.error).toBe("simulated parse failure");

    // Chunks are not deleted by fail() — the orchestrator decides when to
    // call deleteSession. Verify we can still read the rows back.
    const rows = await collect(
      WorkbookCacheService.readRows("upload-session:f", "s", 0, 2)
    );
    expect(rows).toEqual([["a"], ["b"]]);
  });

  it("deleteSession removes meta + every per-sheet chunk + merges under the prefix", async () => {
    const writer = await WorkbookCacheService.beginSession("upload-session:d");
    await writer.appendRows("s", [["a"]]);
    await writer.finishSheet("s", {
      name: "S",
      rowCount: 1,
      colCount: 1,
      merges: [{ startRow: 1, startCol: 1, endRow: 1, endCol: 1 }],
    });
    await writer.finalize("ready");
    expect(store.size).toBeGreaterThanOrEqual(3); // meta + rows:0 + merges

    await WorkbookCacheService.deleteSession("upload-session:d");
    expect(
      [...store.keys()].filter((k) => k.startsWith("upload-session:d"))
    ).toHaveLength(0);
  });

  it("isolates two sessions under different prefixes — no cross-talk on delete", async () => {
    const a = await WorkbookCacheService.beginSession("upload-session:a");
    await a.appendRows("s", [["a"]]);
    await a.finishSheet("s", { name: "A", rowCount: 1, colCount: 1 });
    await a.finalize("ready");

    const b = await WorkbookCacheService.beginSession("upload-session:b");
    await b.appendRows("s", [["b"]]);
    await b.finishSheet("s", { name: "B", rowCount: 1, colCount: 1 });
    await b.finalize("ready");

    await WorkbookCacheService.deleteSession("upload-session:a");

    expect(
      await WorkbookCacheService.getSessionMeta("upload-session:a")
    ).toBeNull();
    expect(
      await WorkbookCacheService.getSessionMeta("upload-session:b")
    ).not.toBeNull();
  });
});
