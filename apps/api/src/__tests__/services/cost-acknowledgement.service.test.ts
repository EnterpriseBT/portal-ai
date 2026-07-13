import { jest, describe, it, expect, beforeEach } from "@jest/globals";

// ── Mocks ────────────────────────────────────────────────────────────

const mockRedisGet = jest.fn<() => Promise<string | null>>();
const mockRedisSet = jest
  .fn<
    (
      key: string,
      value: string,
      mode: "EX",
      seconds: number
    ) => Promise<unknown>
  >()
  .mockResolvedValue("OK");
const mockRedisDel = jest.fn<() => Promise<number>>().mockResolvedValue(1);

jest.unstable_mockModule("../../utils/redis.util.js", () => ({
  getRedisClient: () => ({
    get: mockRedisGet,
    set: mockRedisSet,
    del: mockRedisDel,
  }),
}));

const mockLatestUserMessageTimestamp = jest.fn<() => Promise<number | null>>();
jest.unstable_mockModule("../../services/db.service.js", () => ({
  DbService: {
    repository: {
      portalMessages: {
        latestUserMessageTimestamp: mockLatestUserMessageTimestamp,
      },
    },
  },
}));

const { CostAcknowledgementService, computeJobSignature } =
  await import("../../services/cost-acknowledgement.service.js");

const PORTAL_ID = "portal-1";

const INPUTS = {
  sourceConnectorEntityId: "ce-source",
  targetConnectorEntityId: "ce-target",
  expression: { kind: "tool" as const, ref: "expensive_tool" },
  keyField: "c_id",
  batchSize: 1_000,
};

// ── Tests ────────────────────────────────────────────────────────────

describe("computeJobSignature", () => {
  it("returns the same hash for the same inputs", () => {
    const a = computeJobSignature(INPUTS);
    const b = computeJobSignature(INPUTS);
    expect(a).toBe(b);
    expect(a.length).toBe(32);
  });

  it("returns a different hash when any input changes", () => {
    const base = computeJobSignature(INPUTS);
    expect(computeJobSignature({ ...INPUTS, batchSize: 2_000 })).not.toBe(base);
    expect(computeJobSignature({ ...INPUTS, keyField: "c_other" })).not.toBe(
      base
    );
    expect(
      computeJobSignature({
        ...INPUTS,
        targetConnectorEntityId: "ce-other",
      })
    ).not.toBe(base);
  });
});

describe("CostAcknowledgementService.validate", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("rejects with reason=missing when no pending entry exists", async () => {
    mockRedisGet.mockResolvedValueOnce(null);
    const sig = computeJobSignature(INPUTS);

    const result = await CostAcknowledgementService.validate(PORTAL_ID, sig);

    expect(result).toEqual({ ok: false, reason: "missing" });
    expect(mockLatestUserMessageTimestamp).not.toHaveBeenCalled();
    expect(mockRedisDel).not.toHaveBeenCalled();
  });

  it("rejects with reason=stale when user hasn't replied since rejection", async () => {
    mockRedisGet.mockResolvedValueOnce("1000");
    // user's most recent message is BEFORE the rejection (stale)
    mockLatestUserMessageTimestamp.mockResolvedValueOnce(500);
    const sig = computeJobSignature(INPUTS);

    const result = await CostAcknowledgementService.validate(PORTAL_ID, sig);

    expect(result).toEqual({ ok: false, reason: "stale" });
    expect(mockRedisDel).not.toHaveBeenCalled();
  });

  it("rejects with reason=stale when no user message exists in portal at all", async () => {
    mockRedisGet.mockResolvedValueOnce("1000");
    mockLatestUserMessageTimestamp.mockResolvedValueOnce(null);
    const sig = computeJobSignature(INPUTS);

    const result = await CostAcknowledgementService.validate(PORTAL_ID, sig);

    expect(result).toEqual({ ok: false, reason: "stale" });
  });

  it("rejects with reason=stale when user-msg-timestamp equals rejectedAt (boundary)", async () => {
    mockRedisGet.mockResolvedValueOnce("1000");
    mockLatestUserMessageTimestamp.mockResolvedValueOnce(1000);
    const sig = computeJobSignature(INPUTS);

    const result = await CostAcknowledgementService.validate(PORTAL_ID, sig);

    // Strict greater-than: equal timestamps mean the message was the one
    // the rejection responded to, not a new consenting message.
    expect(result).toEqual({ ok: false, reason: "stale" });
  });

  it("accepts when user replied after the rejection, and clears the entry", async () => {
    mockRedisGet.mockResolvedValueOnce("1000");
    mockLatestUserMessageTimestamp.mockResolvedValueOnce(2000);
    const sig = computeJobSignature(INPUTS);

    const result = await CostAcknowledgementService.validate(PORTAL_ID, sig);

    expect(result).toEqual({ ok: true });
    expect(mockRedisDel).toHaveBeenCalledTimes(1);
  });
});

describe("CostAcknowledgementService.recordRejection", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("stores the rejectedAt timestamp under the per-portal/per-signature key with TTL", async () => {
    await CostAcknowledgementService.recordRejection(PORTAL_ID, "sig-x", 1234);

    expect(mockRedisSet).toHaveBeenCalledTimes(1);
    const args = mockRedisSet.mock.calls[0];
    expect(args[0]).toContain(PORTAL_ID);
    expect(args[0]).toContain("sig-x");
    expect(args[1]).toBe("1234");
    expect(args[2]).toBe("EX");
    expect(args[3]).toBe(15 * 60);
  });
});
