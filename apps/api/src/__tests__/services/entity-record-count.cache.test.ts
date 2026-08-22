/**
 * `EntityRecordCountCache` — the cached exact total for the record list
 * (#433).
 *
 * Two properties matter more than the caching itself:
 *
 *  - **Fail open.** A Redis miss, error, or outage must degrade to "compute
 *    the count", never to an error and never to a hang. The hang case is not
 *    theoretical: `maxRetriesPerRequest: null` means an unreachable Redis
 *    queues commands forever rather than rejecting them (#311), which is why
 *    every call is bounded.
 *  - **The fingerprint covers size, not order.** Including `sortBy` or
 *    `offset` would miss the cache on every page and defeat the whole thing;
 *    omitting `search` or `filters` would report another result set's total.
 */

import { jest, describe, it, expect, beforeEach } from "@jest/globals";

const mockGet = jest.fn<(key: string) => Promise<string | null>>();
const mockSet = jest.fn<(...args: unknown[]) => Promise<unknown>>();
const mockIncr = jest.fn<(key: string) => Promise<number>>();

jest.unstable_mockModule("../../utils/redis.util.js", () => ({
  getRedisClient: () => ({ get: mockGet, set: mockSet, incr: mockIncr }),
}));

const { EntityRecordCountCache, COUNT_CACHE_TTL_SECONDS } =
  await import("../../services/entity-record-count.cache.js");

/** A promise that never settles — ioredis's offline queue during an outage. */
const neverSettles = <T>() => new Promise<T>(() => {});

const ENTITY = "entity-1";

describe("EntityRecordCountCache.fingerprint", () => {
  it("changes when a size-affecting input changes", () => {
    const base = EntityRecordCountCache.fingerprint({});
    expect(EntityRecordCountCache.fingerprint({ search: "boston" })).not.toBe(
      base
    );
    expect(EntityRecordCountCache.fingerprint({ filters: "abc" })).not.toBe(
      base
    );
    expect(EntityRecordCountCache.fingerprint({ isValid: "false" })).not.toBe(
      base
    );
  });

  it("is stable for the same inputs", () => {
    const scope = { search: "boston", filters: "abc", isValid: "true" };
    expect(EntityRecordCountCache.fingerprint(scope)).toBe(
      EntityRecordCountCache.fingerprint({ ...scope })
    );
  });

  it("treats an omitted input and an empty one alike", () => {
    expect(EntityRecordCountCache.fingerprint({})).toBe(
      EntityRecordCountCache.fingerprint({ search: "", filters: "" })
    );
  });

  it("ignores paging and ordering, which do not change the total", () => {
    // The whole point: paging must hit the cache the first page populated.
    const scope = { search: "boston" };
    const withPaging = {
      ...scope,
      sortBy: "city",
      sortOrder: "desc",
      limit: 50,
      offset: 900,
      cursor: "abc",
    } as never;
    expect(EntityRecordCountCache.fingerprint(withPaging)).toBe(
      EntityRecordCountCache.fingerprint(scope)
    );
  });
});

describe("EntityRecordCountCache.get", () => {
  beforeEach(() => {
    mockGet.mockReset();
    mockSet.mockReset();
    mockIncr.mockReset();
  });

  it("returns the cached total", async () => {
    mockGet.mockResolvedValueOnce("3").mockResolvedValueOnce("283000");
    await expect(EntityRecordCountCache.get(ENTITY, "fp")).resolves.toBe(
      283000
    );
  });

  it("scopes the key to the entity and its version", async () => {
    mockGet.mockResolvedValueOnce("7").mockResolvedValueOnce("42");
    await EntityRecordCountCache.get(ENTITY, "fp");
    expect(mockGet).toHaveBeenNthCalledWith(1, `erc:v:${ENTITY}`);
    expect(mockGet).toHaveBeenNthCalledWith(2, `erc:${ENTITY}:7:fp`);
  });

  it("treats an unversioned entity as version 0", async () => {
    mockGet.mockResolvedValueOnce(null).mockResolvedValueOnce("42");
    await EntityRecordCountCache.get(ENTITY, "fp");
    expect(mockGet).toHaveBeenNthCalledWith(2, `erc:${ENTITY}:0:fp`);
  });

  it("returns null on a miss", async () => {
    mockGet.mockResolvedValueOnce("0").mockResolvedValueOnce(null);
    await expect(EntityRecordCountCache.get(ENTITY, "fp")).resolves.toBeNull();
  });

  it("returns null — not a throw — when Redis errors", async () => {
    mockGet.mockRejectedValue(new Error("ECONNREFUSED"));
    await expect(EntityRecordCountCache.get(ENTITY, "fp")).resolves.toBeNull();
  });

  it("returns null rather than hanging when Redis never answers", async () => {
    // The #311 failure mode: an unreachable Redis queues the command instead
    // of rejecting, so an unbounded call would hold the request open.
    mockGet.mockImplementation(() => neverSettles<string | null>());
    const started = Date.now();
    await expect(EntityRecordCountCache.get(ENTITY, "fp")).resolves.toBeNull();
    expect(Date.now() - started).toBeLessThan(3000);
  });

  it("returns null for a corrupt cached value", async () => {
    mockGet.mockResolvedValueOnce("0").mockResolvedValueOnce("not-a-number");
    await expect(EntityRecordCountCache.get(ENTITY, "fp")).resolves.toBeNull();
  });
});

describe("EntityRecordCountCache.set", () => {
  beforeEach(() => {
    mockGet.mockReset();
    mockSet.mockReset();
    mockIncr.mockReset();
  });

  it("writes the total under the current version with a TTL", async () => {
    mockGet.mockResolvedValueOnce("2");
    mockSet.mockResolvedValueOnce("OK");

    await EntityRecordCountCache.set(ENTITY, "fp", 283000);

    expect(mockSet).toHaveBeenCalledWith(
      `erc:${ENTITY}:2:fp`,
      "283000",
      "EX",
      COUNT_CACHE_TTL_SECONDS
    );
  });

  it("swallows a Redis failure", async () => {
    mockGet.mockResolvedValueOnce("0");
    mockSet.mockRejectedValue(new Error("READONLY"));
    await expect(
      EntityRecordCountCache.set(ENTITY, "fp", 1)
    ).resolves.toBeUndefined();
  });

  it("swallows an outage rather than hanging", async () => {
    mockGet.mockImplementation(() => neverSettles<string | null>());
    const started = Date.now();
    await expect(
      EntityRecordCountCache.set(ENTITY, "fp", 1)
    ).resolves.toBeUndefined();
    expect(Date.now() - started).toBeLessThan(3000);
  });
});

describe("EntityRecordCountCache.invalidate", () => {
  beforeEach(() => {
    mockGet.mockReset();
    mockSet.mockReset();
    mockIncr.mockReset();
  });

  it("bumps the entity's version, orphaning every cached fingerprint", async () => {
    mockIncr.mockResolvedValueOnce(1);
    await EntityRecordCountCache.invalidate(ENTITY);
    expect(mockIncr).toHaveBeenCalledWith(`erc:v:${ENTITY}`);
  });

  it("makes a previously cached total miss", async () => {
    mockGet.mockResolvedValueOnce("0").mockResolvedValueOnce("100");
    await expect(EntityRecordCountCache.get(ENTITY, "fp")).resolves.toBe(100);

    // After the bump the reader looks under a version nothing was written to.
    mockIncr.mockResolvedValueOnce(1);
    await EntityRecordCountCache.invalidate(ENTITY);

    mockGet.mockResolvedValueOnce("1").mockResolvedValueOnce(null);
    await expect(EntityRecordCountCache.get(ENTITY, "fp")).resolves.toBeNull();
  });

  it("swallows a Redis failure — stale totals expire via TTL", async () => {
    mockIncr.mockRejectedValue(new Error("ECONNREFUSED"));
    await expect(
      EntityRecordCountCache.invalidate(ENTITY)
    ).resolves.toBeUndefined();
  });

  it("swallows an outage rather than hanging", async () => {
    mockIncr.mockImplementation(() => neverSettles<number>());
    const started = Date.now();
    await expect(
      EntityRecordCountCache.invalidate(ENTITY)
    ).resolves.toBeUndefined();
    expect(Date.now() - started).toBeLessThan(3000);
  });
});
