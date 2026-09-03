/**
 * AgentTurnCeilingService (#498) — pre-turn admission for the un-charged
 * agent-turn ceiling. NEVER throws: any infra or tier-resolution failure
 * fails OPEN (turns are an un-charged safety bound; vendor caps backstop).
 * Minute window checks before day; null limits skip Redis entirely.
 */

import { jest, it, expect, beforeEach } from "@jest/globals";

// ── Mocks ────────────────────────────────────────────────────────────

const mockResolveTier = jest.fn<() => Promise<unknown>>();
jest.unstable_mockModule("../../services/tier.service.js", () => ({
  TierService: { resolveTier: mockResolveTier },
}));

const mockFindById = jest.fn<() => Promise<unknown>>();
jest.unstable_mockModule("../../services/db.service.js", () => ({
  DbService: {
    repository: { organizations: { findById: mockFindById } },
  },
}));

const mockIncrementFixedWindow =
  jest.fn<
    (
      key: string,
      windowMs: number,
      ttl: number,
      now?: number
    ) => Promise<number>
  >();
jest.unstable_mockModule("../../utils/rate-limit.util.js", () => ({
  incrementFixedWindow: mockIncrementFixedWindow,
}));

const mockWarn = jest.fn();
jest.unstable_mockModule("../../utils/logger.util.js", () => ({
  createLogger: () => ({
    warn: mockWarn,
    info: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  }),
}));

const { AgentTurnCeilingService } =
  await import("../../services/agent-turn-ceiling.service.js");

// ── Fixtures ─────────────────────────────────────────────────────────

const ORG = "org-42";
const policy = (perMin: number | null, perDay: number | null) => ({
  agentTurns: { perMin, perDay },
});

beforeEach(() => {
  mockResolveTier.mockReset();
  mockFindById.mockReset().mockResolvedValue({ id: ORG, tier: "standard" });
  mockIncrementFixedWindow.mockReset();
  mockWarn.mockReset();
});

it("allows under both limits, incrementing minute then day windows", async () => {
  mockResolveTier.mockResolvedValue(policy(3, 9));
  mockIncrementFixedWindow.mockResolvedValueOnce(1).mockResolvedValueOnce(4);

  const admission = await AgentTurnCeilingService.checkAdmission(ORG);
  expect(admission).toEqual({ allowed: true });
  const calls = mockIncrementFixedWindow.mock.calls;
  expect(calls[0][0]).toBe(`agent-turns:${ORG}:min`);
  expect(calls[0][1]).toBe(60_000);
  expect(calls[1][0]).toBe(`agent-turns:${ORG}:day`);
  expect(calls[1][1]).toBe(86_400_000);
});

it("denies on the minute window with retryAfter to the minute boundary", async () => {
  mockResolveTier.mockResolvedValue(policy(3, 9));
  mockIncrementFixedWindow.mockResolvedValueOnce(4); // > 3
  const now = 60_000 * 100 + 15_000; // 15s into a minute

  const admission = await AgentTurnCeilingService.checkAdmission(ORG, now);
  expect(admission).toEqual({
    allowed: false,
    window: "minute",
    limit: 3,
    retryAfterSeconds: 45,
  });
  expect(mockWarn).toHaveBeenCalledWith(
    expect.objectContaining({
      organizationId: ORG,
      window: "minute",
      limit: 3,
    }),
    expect.any(String)
  );
});

it("denies on the day window with retryAfter to the next UTC midnight", async () => {
  mockResolveTier.mockResolvedValue(policy(null, 9));
  mockIncrementFixedWindow.mockResolvedValueOnce(10); // day window only; > 9
  const DAY = 86_400_000;
  const now = DAY * 20_000 + 6 * 60 * 60 * 1000; // 06:00 UTC

  const admission = await AgentTurnCeilingService.checkAdmission(ORG, now);
  expect(admission).toEqual({
    allowed: false,
    window: "day",
    limit: 9,
    retryAfterSeconds: 18 * 60 * 60,
  });
});

it("null limits skip Redis entirely (enterprise/custom tiers)", async () => {
  mockResolveTier.mockResolvedValue(policy(null, null));
  const admission = await AgentTurnCeilingService.checkAdmission(ORG);
  expect(admission).toEqual({ allowed: true });
  expect(mockIncrementFixedWindow).not.toHaveBeenCalled();
});

it("fails open with a warn when the window util throws", async () => {
  mockResolveTier.mockResolvedValue(policy(3, 9));
  mockIncrementFixedWindow.mockRejectedValue(new Error("redis down"));
  const admission = await AgentTurnCeilingService.checkAdmission(ORG);
  expect(admission).toEqual({ allowed: true });
  expect(mockWarn).toHaveBeenCalled();
});

it("fails open with a warn when tier resolution throws", async () => {
  mockResolveTier.mockRejectedValue(new Error("db down"));
  const admission = await AgentTurnCeilingService.checkAdmission(ORG);
  expect(admission).toEqual({ allowed: true });
  expect(mockWarn).toHaveBeenCalled();
  expect(mockIncrementFixedWindow).not.toHaveBeenCalled();
});

it("a minute-window pass still increments the day window before the day check", async () => {
  mockResolveTier.mockResolvedValue(policy(3, 9));
  mockIncrementFixedWindow.mockResolvedValueOnce(2).mockResolvedValueOnce(10);

  const admission = await AgentTurnCeilingService.checkAdmission(ORG, 0);
  expect(admission).toMatchObject({ allowed: false, window: "day" });
  expect(mockIncrementFixedWindow).toHaveBeenCalledTimes(2);
});
