import { jest, describe, it, expect, beforeEach } from "@jest/globals";
import { ApiCode } from "../../constants/api-codes.constants.js";

// ── Mocks (the gate's collaborators) ─────────────────────────────────

const mockFindById = jest.fn<(id: string) => Promise<unknown>>();
const mockResolveTier = jest.fn<(org: unknown, now?: number) => Promise<unknown>>();
const mockPeriodIdFor = jest.fn<() => string>();
const mockTryCharge =
  jest.fn<
    (...a: unknown[]) => Promise<{ allowed: boolean; used: number; available: number | null }>
  >();
const mockIncrementRate = jest.fn<() => Promise<number>>();

jest.unstable_mockModule("../../services/db.service.js", () => ({
  DbService: { repository: { organizations: { findById: mockFindById } } },
}));
jest.unstable_mockModule("../../services/tier.service.js", () => ({
  TierService: { resolveTier: mockResolveTier, periodIdFor: mockPeriodIdFor },
}));
jest.unstable_mockModule("../../services/usage.service.js", () => ({
  UsageService: { tryCharge: mockTryCharge },
}));
jest.unstable_mockModule("../../utils/rate-limit.util.js", () => ({
  incrementRateWindow: mockIncrementRate,
}));

const { CostGateService, COST_RESOLVERS, wrapWithCostGate } = await import(
  "../../services/cost-gate.service.js"
);

// ── Fixtures ─────────────────────────────────────────────────────────

const org = { id: "org-1", tier: "standard" };
const policy = {
  tier: "standard",
  period: { kind: "monthly", anchorDay: 1 },
  allocations: {
    free: { unitsPerPeriod: null, ratePerMin: null },
    metered: { unitsPerPeriod: 1000, ratePerMin: 20 },
    expensive: { unitsPerPeriod: 100, ratePerMin: 5 },
  },
  perToolCaps: null,
  overage: "hard-deny",
};

const ctx = (over: Record<string, unknown> = {}) => ({
  organizationId: "org-1",
  toolName: "web_search",
  costHint: "metered" as const,
  costBearer: "application" as const,
  input: {},
  actor: { userId: "u1" },
  now: 1000,
  ...over,
});

beforeEach(() => {
  for (const k of Object.keys(COST_RESOLVERS)) delete COST_RESOLVERS[k];
  mockFindById.mockReset().mockResolvedValue(org);
  mockResolveTier.mockReset().mockResolvedValue(policy);
  mockPeriodIdFor.mockReset().mockReturnValue("2026-07");
  mockIncrementRate.mockReset().mockResolvedValue(1);
  mockTryCharge
    .mockReset()
    .mockResolvedValue({ allowed: true, used: 1, available: 999 });
});

// ── Tests ────────────────────────────────────────────────────────────

describe("CostGateService.resolveCostGate", () => {
  it("case 1 — free tools are allowed with no resolve/charge/rate", async () => {
    const r = await CostGateService.resolveCostGate(ctx({ costHint: "free" }));
    expect(r).toEqual({ allowed: true });
    expect(mockResolveTier).not.toHaveBeenCalled();
    expect(mockTryCharge).not.toHaveBeenCalled();
    expect(mockIncrementRate).not.toHaveBeenCalled();
  });

  it("case 2 — org-paid (custom) tools are allowed, never charged", async () => {
    const r = await CostGateService.resolveCostGate(
      ctx({ costBearer: "organization" })
    );
    expect(r).toEqual({ allowed: true });
    expect(mockTryCharge).not.toHaveBeenCalled();
  });

  it("case 3 — a 0-unit resolver short-circuits to allowed, no charge", async () => {
    COST_RESOLVERS["web_search"] = () => 0;
    const r = await CostGateService.resolveCostGate(ctx());
    expect(r).toEqual({ allowed: true });
    expect(mockTryCharge).not.toHaveBeenCalled();
  });

  it("case 4 — within allocation charges the units and allows", async () => {
    const r = await CostGateService.resolveCostGate(ctx());
    expect(r).toEqual({ allowed: true });
    expect(mockTryCharge).toHaveBeenCalledWith(
      "org-1",
      "metered",
      1,
      1000,
      "2026-07",
      { userId: "u1" }
    );
  });

  it("case 5 — over the per-minute rate denies (RATE_LIMITED); no quota charge", async () => {
    mockIncrementRate.mockResolvedValue(21); // > ratePerMin 20
    const r = await CostGateService.resolveCostGate(ctx());
    expect(r.allowed).toBe(false);
    if (!r.allowed) {
      expect(r.result.error.code).toBe(ApiCode.TOOL_USAGE_RATE_LIMITED);
      expect(r.result.error.retryAfter).toBe(60);
    }
    expect(mockTryCharge).not.toHaveBeenCalled();
  });

  it("case 6 — exhausted quota denies (QUOTA_EXCEEDED)", async () => {
    mockTryCharge.mockResolvedValue({ allowed: false, used: 1000, available: 0 });
    const r = await CostGateService.resolveCostGate(ctx());
    expect(r.allowed).toBe(false);
    if (!r.allowed) {
      expect(r.result.error.code).toBe(ApiCode.TOOL_USAGE_QUOTA_EXCEEDED);
      expect(r.result.error.message).toMatch(/exhausted/);
    }
  });

  it("case 7 — expensive is charged too (against its allocation)", async () => {
    await CostGateService.resolveCostGate(ctx({ costHint: "expensive" }));
    expect(mockTryCharge).toHaveBeenCalledWith(
      "org-1",
      "expensive",
      1,
      100, // expensive.unitsPerPeriod
      "2026-07",
      { userId: "u1" }
    );
  });

  it("case 8 — infra error fails open (allowed), never throws", async () => {
    mockResolveTier.mockRejectedValue(new Error("db down"));
    const r = await CostGateService.resolveCostGate(ctx());
    expect(r).toEqual({ allowed: true });
  });

  it("case 9 — deny result shape is { error: { code, message } }, never a throw", async () => {
    mockTryCharge.mockResolvedValue({ allowed: false, used: 1000, available: 0 });
    const r = await CostGateService.resolveCostGate(ctx());
    expect(r.allowed).toBe(false);
    if (!r.allowed) {
      expect(typeof r.result.error.code).toBe("string");
      expect(typeof r.result.error.message).toBe("string");
    }
  });

  it("case 10 — rate limiter (Redis) failure fails open on rate only; quota still charges", async () => {
    mockIncrementRate.mockRejectedValue(new Error("redis down"));
    const r = await CostGateService.resolveCostGate(ctx());
    // The rate check swallows the Redis error, but the quota charge below
    // still runs — Postgres remains the spend backstop (the split fail policy).
    expect(mockTryCharge).toHaveBeenCalledWith(
      "org-1",
      "metered",
      1,
      1000,
      "2026-07",
      { userId: "u1" }
    );
    expect(r).toEqual({ allowed: true });
  });

  it("case 11 — Redis down + exhausted quota still denies (quota is the backstop)", async () => {
    mockIncrementRate.mockRejectedValue(new Error("redis down"));
    mockTryCharge.mockResolvedValue({ allowed: false, used: 1000, available: 0 });
    const r = await CostGateService.resolveCostGate(ctx());
    // Before the split fail policy this would have failed open (allowed);
    // now the quota still enforces even when the rate limiter is unavailable.
    expect(r.allowed).toBe(false);
    if (!r.allowed) {
      expect(r.result.error.code).toBe(ApiCode.TOOL_USAGE_QUOTA_EXCEEDED);
    }
  });
});

describe("wrapWithCostGate", () => {
  const appMeta = () =>
    ({ costHint: "metered", costBearer: "application" }) as const;

  it("allowed → delegates to the original execute", async () => {
    const original = jest.fn(async (_i: unknown, _o: unknown) => "REAL");
    const tools = { web_search: { execute: original } };
    wrapWithCostGate(tools, { organizationId: "org-1", userId: "u1" }, appMeta);
    await expect(tools.web_search.execute({ q: 1 }, {})).resolves.toBe("REAL");
    expect(original).toHaveBeenCalledWith({ q: 1 }, {});
  });

  it("denied → returns the deny-result object (no throw), original NOT run", async () => {
    mockTryCharge.mockResolvedValue({ allowed: false, used: 1000, available: 0 });
    const original = jest.fn(async (_i: unknown, _o: unknown) => "REAL");
    const tools = { web_search: { execute: original } };
    wrapWithCostGate(tools, { organizationId: "org-1", userId: "u1" }, appMeta);
    const out = (await tools.web_search.execute({}, {})) as unknown as {
      error: { code: string };
    };
    expect(out.error.code).toBe(ApiCode.TOOL_USAGE_QUOTA_EXCEEDED);
    expect(original).not.toHaveBeenCalled();
  });

  it("org-paid (custom) → allowed, original runs, never charged", async () => {
    const original = jest.fn(async (_i: unknown, _o: unknown) => "REAL");
    const tools = { my_hook: { execute: original } };
    wrapWithCostGate(tools, { organizationId: "org-1", userId: "u1" }, () => ({
      costHint: "metered",
      costBearer: "organization",
    }));
    await expect(tools.my_hook.execute({}, {})).resolves.toBe("REAL");
    expect(mockTryCharge).not.toHaveBeenCalled();
  });

  it("leaves a tool without an execute untouched", () => {
    const tools: Record<
      string,
      { execute?: (i: unknown, o: unknown) => unknown }
    > = { noop: {} };
    expect(() =>
      wrapWithCostGate(tools, { organizationId: "o", userId: "u" }, () => ({
        costHint: "free",
        costBearer: "application",
      }))
    ).not.toThrow();
  });
});
