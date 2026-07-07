import { jest, describe, it, expect, beforeEach } from "@jest/globals";

// ── Mocks ────────────────────────────────────────────────────────────

const mockFindForPeriod =
  jest.fn<
    (org: string, period: string) => Promise<Array<Record<string, unknown>>>
  >();
const mockIncrement =
  jest.fn<(row: Record<string, unknown>) => Promise<void>>();

jest.unstable_mockModule("../../services/db.service.js", () => ({
  DbService: {
    repository: {
      usage: { findForPeriod: mockFindForPeriod, increment: mockIncrement },
    },
  },
}));

const { UsageService } = await import("../../services/usage.service.js");

// ── Fixtures ─────────────────────────────────────────────────────────

const policy = {
  tier: "standard",
  period: { kind: "monthly" as const, anchorDay: 1 },
  allocations: {
    free: { unitsPerPeriod: null, ratePerMin: null },
    metered: { unitsPerPeriod: 1000, ratePerMin: 20 },
    expensive: { unitsPerPeriod: 100, ratePerMin: 5 },
  },
  perToolCaps: null,
  overage: "hard-deny" as const,
};

beforeEach(() => {
  mockFindForPeriod.mockReset();
  mockIncrement.mockReset();
});

// ── getBalance (case 24) ─────────────────────────────────────────────

describe("UsageService.getBalance", () => {
  it("computes available = allocation − used; used 0 when absent; null when unlimited; clamps at 0", async () => {
    mockFindForPeriod.mockResolvedValue([
      { costClass: "metered", unitsUsed: 30 },
      { costClass: "expensive", unitsUsed: 150 }, // over-allocation → clamp to 0
    ]);

    const bal = await UsageService.getBalance(
      { id: "o1" },
      policy,
      new Date(Date.UTC(2026, 6, 15))
    );

    expect(bal.periodId).toBe("2026-07");
    expect(bal.byClass.free).toEqual({ used: 0, available: null }); // unlimited
    expect(bal.byClass.metered).toEqual({ used: 30, available: 970 });
    expect(bal.byClass.expensive).toEqual({ used: 150, available: 0 }); // clamped
    expect(mockFindForPeriod).toHaveBeenCalledWith("o1", "2026-07");
  });
});

// ── increment (case 25) ──────────────────────────────────────────────

describe("UsageService.increment", () => {
  it("no-ops for units <= 0", async () => {
    await UsageService.increment("o1", "metered", 0, "2026-07", {
      userId: "u1",
    });
    expect(mockIncrement).not.toHaveBeenCalled();
  });

  it("builds a usage row and calls the repository", async () => {
    mockIncrement.mockResolvedValue(undefined);
    await UsageService.increment("o1", "metered", 30, "2026-07", {
      userId: "u1",
    });
    expect(mockIncrement).toHaveBeenCalledTimes(1);
    const row = mockIncrement.mock.calls[0][0];
    expect(row.organizationId).toBe("o1");
    expect(row.periodId).toBe("2026-07");
    expect(row.costClass).toBe("metered");
    expect(row.unitsUsed).toBe(30);
    expect(row.createdBy).toBe("u1");
  });
});
