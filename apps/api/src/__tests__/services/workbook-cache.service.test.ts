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
    async del(key: string) {
      const had = store.has(key);
      store.delete(key);
      return had ? 1 : 0;
    },
  }),
}));

const { WorkbookCacheService } = await import(
  "../../services/workbook-cache.service.js"
);

import type { WorkbookData } from "@portalai/spreadsheet-parsing";

const sampleWorkbook: WorkbookData = {
  sheets: [
    {
      name: "Sheet1",
      dimensions: { rows: 1, cols: 1 },
      cells: [{ row: 1, col: 1, value: "hello" }],
    },
  ],
};

const otherWorkbook: WorkbookData = {
  sheets: [
    {
      name: "Other",
      dimensions: { rows: 1, cols: 1 },
      cells: [{ row: 1, col: 1, value: "world" }],
    },
  ],
};

describe("WorkbookCacheService", () => {
  beforeEach(() => {
    store.clear();
  });

  it("set + get round-trips a workbook under an opaque cache key", async () => {
    await WorkbookCacheService.set("upload-session:abc", sampleWorkbook);
    const out = await WorkbookCacheService.get("upload-session:abc");
    expect(out).toEqual(sampleWorkbook);
  });

  it("isolates entries across different cache keys (file-upload vs google-sheets)", async () => {
    await WorkbookCacheService.set("upload-session:abc", sampleWorkbook);
    await WorkbookCacheService.set("gsheets:wb:abc", otherWorkbook);

    const upload = await WorkbookCacheService.get("upload-session:abc");
    const gsheets = await WorkbookCacheService.get("gsheets:wb:abc");

    expect(upload?.sheets[0]?.cells[0]?.value).toBe("hello");
    expect(gsheets?.sheets[0]?.cells[0]?.value).toBe("world");
  });

  it("delete on one key does not affect the other", async () => {
    await WorkbookCacheService.set("upload-session:abc", sampleWorkbook);
    await WorkbookCacheService.set("gsheets:wb:abc", sampleWorkbook);

    await WorkbookCacheService.delete("upload-session:abc");

    expect(await WorkbookCacheService.get("upload-session:abc")).toBeNull();
    expect(await WorkbookCacheService.get("gsheets:wb:abc")).toEqual(
      sampleWorkbook
    );
  });

  it("returns null on cache miss", async () => {
    expect(await WorkbookCacheService.get("not-cached")).toBeNull();
  });
});
