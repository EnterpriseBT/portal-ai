import { jest, describe, it, expect, beforeEach } from "@jest/globals";

const mockIncr = jest.fn<(key: string) => Promise<number>>();
const mockExpire = jest.fn<(key: string, seconds: number) => Promise<number>>();

jest.unstable_mockModule("../../utils/redis.util.js", () => ({
  getRedisClient: () => ({ incr: mockIncr, expire: mockExpire }),
}));

const { incrementRateWindow } = await import("../../utils/rate-limit.util.js");

beforeEach(() => {
  mockIncr.mockReset();
  mockExpire.mockReset();
});

describe("incrementRateWindow", () => {
  it("returns the new count and sets TTL on the first increment of a window", async () => {
    mockIncr.mockResolvedValue(1);
    const n = await incrementRateWindow("org:metered", 60_000); // minute 1
    expect(n).toBe(1);
    expect(mockIncr).toHaveBeenCalledWith("usage:rate:org:metered:1");
    expect(mockExpire).toHaveBeenCalledWith("usage:rate:org:metered:1", 120);
  });

  it("does not reset the TTL on subsequent increments of the same window", async () => {
    mockIncr.mockResolvedValue(2);
    await incrementRateWindow("org:metered", 60_000);
    expect(mockExpire).not.toHaveBeenCalled();
  });

  it("uses a distinct key per wall-clock minute", async () => {
    mockIncr.mockResolvedValue(1);
    await incrementRateWindow("k", 0); // minute 0
    await incrementRateWindow("k", 120_000); // minute 2
    expect(mockIncr).toHaveBeenCalledWith("usage:rate:k:0");
    expect(mockIncr).toHaveBeenCalledWith("usage:rate:k:2");
  });
});
