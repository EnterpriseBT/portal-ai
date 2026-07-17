import { jest, describe, it, expect, beforeEach } from "@jest/globals";
import { ApiCode } from "../../constants/api-codes.constants.js";

// ── Mocks (the gate's collaborators) ─────────────────────────────────

const mockFindById = jest.fn<(id: string) => Promise<unknown>>();
const mockResolveTier =
  jest.fn<(org: unknown, now?: number) => Promise<unknown>>();
const mockPeriodIdFor = jest.fn<() => string>();
const mockTryCharge =
  jest.fn<
    (
      ...a: unknown[]
    ) => Promise<{ allowed: boolean; used: number; available: number | null }>
  >();
const mockGetBalance = jest.fn<
  (...a: unknown[]) => Promise<{
    periodId: string;
    byClass: Record<string, { used: number; available: number | null }>;
  }>
>();
const mockIncrementRate = jest.fn<() => Promise<number>>();

const mockLedgerInsertIfNew = jest.fn<(...a: unknown[]) => Promise<boolean>>();
const TX = { __tx: true };

jest.unstable_mockModule("../../services/db.service.js", () => ({
  DbService: {
    repository: {
      organizations: { findById: mockFindById },
      toolUsageLedger: { insertIfNew: mockLedgerInsertIfNew },
    },
    // #179: commitCharge pairs the aggregate charge + ledger insert in one
    // transaction; unit tests run the callback with a sentinel client.
    transaction: (fn: (tx: unknown) => Promise<unknown>) => fn(TX),
  },
}));
jest.unstable_mockModule("../../services/tier.service.js", () => ({
  TierService: { resolveTier: mockResolveTier, periodIdFor: mockPeriodIdFor },
}));
jest.unstable_mockModule("../../services/usage.service.js", () => ({
  UsageService: { tryCharge: mockTryCharge, getBalance: mockGetBalance },
}));
jest.unstable_mockModule("../../utils/rate-limit.util.js", () => ({
  incrementRateWindow: mockIncrementRate,
}));

const { CostGateService, COST_RESOLVERS, wrapWithCostGate } =
  await import("../../services/cost-gate.service.js");

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

/** Default balance — plenty of room in every class. */
const affordableBalance = () => ({
  periodId: "2026-07",
  byClass: {
    free: { used: 0, available: null },
    metered: { used: 1, available: 999 },
    expensive: { used: 0, available: 100 },
  },
});

const ctx = (over: Record<string, unknown> = {}) => ({
  organizationId: "org-1",
  toolName: "web_search",
  costHint: "metered" as const,
  costBearer: "application" as const,
  input: {},
  actor: { userId: "u1" },
  stationId: "station-1", // #179 ledger context
  now: 1000,
  ...over,
});

beforeEach(() => {
  for (const k of Object.keys(COST_RESOLVERS)) delete COST_RESOLVERS[k];
  mockFindById.mockReset().mockResolvedValue(org);
  mockResolveTier.mockReset().mockResolvedValue(policy);
  mockPeriodIdFor.mockReset().mockReturnValue("2026-07");
  mockIncrementRate.mockReset().mockResolvedValue(1);
  mockGetBalance.mockReset().mockResolvedValue(affordableBalance());
  mockTryCharge
    .mockReset()
    .mockResolvedValue({ allowed: true, used: 1, available: 999 });
  mockLedgerInsertIfNew.mockReset().mockResolvedValue(true);
});

// ── checkAdmission — pre-flight, NEVER charges ───────────────────────

describe("CostGateService.checkAdmission", () => {
  it("case 1 — free tools admitted with no charge (charge:null); no tier/rate/balance", async () => {
    const r = await CostGateService.checkAdmission(ctx({ costHint: "free" }));
    expect(r).toEqual({ allowed: true, charge: null });
    expect(mockResolveTier).not.toHaveBeenCalled();
    expect(mockGetBalance).not.toHaveBeenCalled();
    expect(mockIncrementRate).not.toHaveBeenCalled();
  });

  it("case 2 — org-paid (custom) tools admitted, charge:null", async () => {
    const r = await CostGateService.checkAdmission(
      ctx({ costBearer: "organization" })
    );
    expect(r).toEqual({ allowed: true, charge: null });
    expect(mockGetBalance).not.toHaveBeenCalled();
  });

  it("case 3 — a 0-unit resolver admits with charge:null", async () => {
    COST_RESOLVERS["web_search"] = () => 0;
    const r = await CostGateService.checkAdmission(ctx());
    expect(r).toEqual({ allowed: true, charge: null });
    expect(mockGetBalance).not.toHaveBeenCalled();
  });

  it("case 4 — within allocation admits with a pending charge; NEVER charges", async () => {
    const r = await CostGateService.checkAdmission(ctx());
    expect(r).toEqual({
      allowed: true,
      charge: {
        organizationId: "org-1",
        costClass: "metered",
        units: 1,
        actor: { userId: "u1" },
        toolName: "web_search",
        toolCallId: expect.any(String),
        stationId: "station-1",
        portalId: null,
      },
    });
    expect(mockTryCharge).not.toHaveBeenCalled(); // admission never charges
  });

  it("case 5 — over the per-minute rate denies (RATE_LIMITED) before the balance read", async () => {
    mockIncrementRate.mockResolvedValue(21); // > ratePerMin 20
    const r = await CostGateService.checkAdmission(ctx());
    expect(r.allowed).toBe(false);
    if (!r.allowed) {
      expect(r.result.error.code).toBe(ApiCode.TOOL_USAGE_RATE_LIMITED);
      expect(r.result.error.retryAfter).toBe(60);
    }
    expect(mockGetBalance).not.toHaveBeenCalled();
    expect(mockTryCharge).not.toHaveBeenCalled();
  });

  it("case 6 — estimate exceeds remaining allocation denies (QUOTA_EXCEEDED)", async () => {
    mockGetBalance.mockResolvedValue({
      periodId: "2026-07",
      byClass: {
        free: { used: 0, available: null },
        metered: { used: 1000, available: 0 },
        expensive: { used: 0, available: 100 },
      },
    });
    const r = await CostGateService.checkAdmission(ctx());
    expect(r.allowed).toBe(false);
    if (!r.allowed) {
      expect(r.result.error.code).toBe(ApiCode.TOOL_USAGE_QUOTA_EXCEEDED);
      expect(r.result.error.message).toMatch(/exhausted/);
    }
    expect(mockTryCharge).not.toHaveBeenCalled();
  });

  it("case 7 — expensive admits a charge against its own class", async () => {
    const r = await CostGateService.checkAdmission(
      ctx({ costHint: "expensive" })
    );
    expect(r).toEqual({
      allowed: true,
      charge: {
        organizationId: "org-1",
        costClass: "expensive",
        units: 1,
        actor: { userId: "u1" },
        toolName: "web_search",
        toolCallId: expect.any(String),
        stationId: "station-1",
        portalId: null,
      },
    });
  });

  it("case 8 — an unlimited class (available null) admits regardless of use", async () => {
    mockGetBalance.mockResolvedValue({
      periodId: "2026-07",
      byClass: {
        free: { used: 0, available: null },
        metered: { used: 9999, available: null },
        expensive: { used: 0, available: 100 },
      },
    });
    const r = await CostGateService.checkAdmission(ctx());
    expect(r.allowed).toBe(true);
    if (r.allowed) expect(r.charge?.units).toBe(1);
  });

  it("case 9 — infra error fails open (allowed, charge:null), never throws", async () => {
    mockResolveTier.mockRejectedValue(new Error("db down"));
    const r = await CostGateService.checkAdmission(ctx());
    expect(r).toEqual({ allowed: true, charge: null });
  });

  it("case 10 — Redis rate failure fails open on rate only; balance still enforces", async () => {
    mockIncrementRate.mockRejectedValue(new Error("redis down"));
    const r = await CostGateService.checkAdmission(ctx());
    // rate error swallowed → affordability read still runs → admitted.
    expect(mockGetBalance).toHaveBeenCalled();
    expect(r.allowed).toBe(true);
  });

  it("case 11 — Redis down + exhausted allocation still denies (quota is the backstop)", async () => {
    mockIncrementRate.mockRejectedValue(new Error("redis down"));
    mockGetBalance.mockResolvedValue({
      periodId: "2026-07",
      byClass: {
        free: { used: 0, available: null },
        metered: { used: 1000, available: 0 },
        expensive: { used: 0, available: 100 },
      },
    });
    const r = await CostGateService.checkAdmission(ctx());
    expect(r.allowed).toBe(false);
    if (!r.allowed) {
      expect(r.result.error.code).toBe(ApiCode.TOOL_USAGE_QUOTA_EXCEEDED);
    }
  });
});

// ── commitCharge — post-success, atomic conditional, no refund ───────

describe("CostGateService.commitCharge", () => {
  const charge = {
    organizationId: "org-1",
    costClass: "metered" as const,
    units: 1,
    actor: { userId: "u1" },
    // #179 per-call context
    toolName: "web_search",
    toolCallId: "call_fixed_1",
    stationId: "station-1",
    portalId: "portal-1" as string | null,
  };

  it("charges the actual units against the class allocation", async () => {
    await CostGateService.commitCharge(charge, 1000);
    expect(mockTryCharge).toHaveBeenCalledWith(
      "org-1",
      "metered",
      1,
      1000, // metered.unitsPerPeriod
      "2026-07",
      { userId: "u1" },
      TX // #179: inside the shared transaction
    );
  });

  it("a null charge is a no-op", async () => {
    await CostGateService.commitCharge(null, 1000);
    expect(mockTryCharge).not.toHaveBeenCalled();
  });

  it("a zero-unit charge is a no-op", async () => {
    await CostGateService.commitCharge({ ...charge, units: 0 }, 1000);
    expect(mockTryCharge).not.toHaveBeenCalled();
  });

  it("an over-allocation charge (tryCharge denies) does not throw — the call was free", async () => {
    mockTryCharge.mockResolvedValue({
      allowed: false,
      used: 1000,
      available: 0,
    });
    await expect(
      CostGateService.commitCharge(charge, 1000)
    ).resolves.toBeUndefined();
  });

  it("swallows an infra error (never throws to the caller)", async () => {
    mockResolveTier.mockRejectedValue(new Error("db down"));
    await expect(
      CostGateService.commitCharge(charge, 1000)
    ).resolves.toBeUndefined();
    expect(mockTryCharge).not.toHaveBeenCalled();
  });
});

const WRAP_CTX = {
  organizationId: "org-1",
  userId: "u1",
  stationId: "station-1",
  portalId: "portal-1",
};

// ── wrapWithCostGate — admit → run → charge-on-success ───────────────

describe("wrapWithCostGate", () => {
  const appMeta = () =>
    ({
      costHint: "metered",
      costBearer: "application",
      deferChargeToJob: false,
    }) as const;

  it("admitted → runs the original AND commits the charge after success", async () => {
    const original = jest.fn(async (_i: unknown, _o: unknown) => "REAL");
    const tools = { web_search: { execute: original } };
    wrapWithCostGate(tools, WRAP_CTX, appMeta);
    await expect(tools.web_search.execute({ q: 1 }, {})).resolves.toBe("REAL");
    expect(original).toHaveBeenCalledWith({ q: 1 }, {});
    // commit fired on success → tryCharge called.
    expect(mockTryCharge).toHaveBeenCalledTimes(1);
  });

  it("a THROWING original is NOT charged (failed calls are free)", async () => {
    const original = jest.fn(async (_i: unknown, _o: unknown) => {
      throw new Error("tavily down");
    });
    const tools = { web_search: { execute: original } };
    wrapWithCostGate(tools, WRAP_CTX, appMeta);
    await expect(tools.web_search.execute({}, {})).rejects.toThrow(
      "tavily down"
    );
    expect(original).toHaveBeenCalled();
    expect(mockTryCharge).not.toHaveBeenCalled(); // never charged
  });

  it("denied at admission → returns the deny-result; original NOT run, no charge", async () => {
    mockGetBalance.mockResolvedValue({
      periodId: "2026-07",
      byClass: {
        free: { used: 0, available: null },
        metered: { used: 1000, available: 0 },
        expensive: { used: 0, available: 100 },
      },
    });
    const original = jest.fn(async (_i: unknown, _o: unknown) => "REAL");
    const tools = { web_search: { execute: original } };
    wrapWithCostGate(tools, WRAP_CTX, appMeta);
    const out = (await tools.web_search.execute({}, {})) as unknown as {
      error: { code: string };
    };
    expect(out.error.code).toBe(ApiCode.TOOL_USAGE_QUOTA_EXCEEDED);
    expect(original).not.toHaveBeenCalled();
    expect(mockTryCharge).not.toHaveBeenCalled();
  });

  it("deferChargeToJob → runs the original but does NOT commit (processor charges)", async () => {
    const original = jest.fn(async (_i: unknown, _o: unknown) => "JOB");
    const tools = { transform_entity_records: { execute: original } };
    wrapWithCostGate(tools, WRAP_CTX, () => ({
      costHint: "expensive",
      costBearer: "application",
      deferChargeToJob: true,
    }));
    await expect(tools.transform_entity_records.execute({}, {})).resolves.toBe(
      "JOB"
    );
    expect(mockTryCharge).not.toHaveBeenCalled();
  });

  it("org-paid (custom) → runs the original, never charged", async () => {
    const original = jest.fn(async (_i: unknown, _o: unknown) => "REAL");
    const tools = { my_hook: { execute: original } };
    wrapWithCostGate(tools, WRAP_CTX, () => ({
      costHint: "metered",
      costBearer: "organization",
      deferChargeToJob: false,
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
      wrapWithCostGate(
        tools,
        { ...WRAP_CTX, organizationId: "o", userId: "u" },
        () => ({
          costHint: "free",
          costBearer: "application",
          deferChargeToJob: false,
        })
      )
    ).not.toThrow();
  });
});

// ── #179: the ledger write (transactional, idempotent) ───────────────

describe("commitCharge ledger write (#179)", () => {
  const charge = {
    organizationId: "org-1",
    costClass: "metered" as const,
    units: 2,
    actor: { userId: "u1" },
    toolName: "web_search",
    toolCallId: "call_ledger_1",
    stationId: "station-1",
    portalId: "portal-1" as string | null,
  };

  // case 7 — same-transaction pairing + full row fields
  it("writes one ledger row with the charge's fields, inside the SAME tx as tryCharge", async () => {
    await CostGateService.commitCharge(charge, 1000);

    expect(mockTryCharge).toHaveBeenCalledWith(
      "org-1",
      "metered",
      2,
      1000,
      "2026-07",
      { userId: "u1" },
      TX
    );
    expect(mockLedgerInsertIfNew).toHaveBeenCalledTimes(1);
    expect(mockLedgerInsertIfNew).toHaveBeenCalledWith(
      expect.objectContaining({
        organizationId: "org-1",
        toolName: "web_search",
        toolCallId: "call_ledger_1",
        stationId: "station-1",
        portalId: "portal-1",
        costClass: "metered",
        units: 2,
        periodId: "2026-07", // the same period the aggregate charged
        userId: "u1",
      }),
      TX
    );
  });

  // case 8 — skip writes nothing
  it("a skipped charge (tryCharge not allowed) writes NO ledger row", async () => {
    mockTryCharge.mockResolvedValue({
      allowed: false,
      used: 1000,
      available: 0,
    });

    await CostGateService.commitCharge(charge, 1000);

    expect(mockLedgerInsertIfNew).not.toHaveBeenCalled();
  });

  // case 9 — insert failure → tx rejects → catch-all → free call
  it("a ledger insert failure rejects the tx but never throws to the caller", async () => {
    mockLedgerInsertIfNew.mockRejectedValue(new Error("insert failed"));

    await expect(
      CostGateService.commitCharge(charge, 1000)
    ).resolves.toBeUndefined();
    // The aggregate ran inside the same tx — Postgres rolls both back
    // together (repo integration covers the real rollback).
    expect(mockTryCharge).toHaveBeenCalled();
  });

  // case 10 — duplicate toolCallId is a no-op
  it("a duplicate toolCallId (insertIfNew false) resolves without error", async () => {
    mockLedgerInsertIfNew.mockResolvedValue(false);

    await expect(
      CostGateService.commitCharge(charge, 1000)
    ).resolves.toBeUndefined();
  });
});

// ── #179: admission context → charge context ─────────────────────────

describe("checkAdmission charge context (#179)", () => {
  it("case 11a — copies toolName/toolCallId/stationId/portalId onto the charge", async () => {
    const r = await CostGateService.checkAdmission(
      ctx({
        stationId: "station-1",
        portalId: "portal-1",
        toolCallId: "call_ctx_1",
      }) as never
    );

    expect(r.allowed).toBe(true);
    if (r.allowed) {
      expect(r.charge).toMatchObject({
        toolName: "web_search",
        toolCallId: "call_ctx_1",
        stationId: "station-1",
        portalId: "portal-1",
      });
    }
  });

  it("case 11b — synthesizes a UUID toolCallId when the context lacks one", async () => {
    const r = await CostGateService.checkAdmission(
      ctx({ stationId: "station-1" }) as never
    );

    expect(r.allowed).toBe(true);
    if (r.allowed && r.charge) {
      expect(r.charge.toolCallId).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
      );
      expect(r.charge.portalId).toBeNull();
    }
  });

  // case 12 — the wrap threads execute options + ctx into admission
  it("case 12 — wrapWithCostGate threads options.toolCallId and ctx station/portal", async () => {
    const spy = jest.spyOn(CostGateService, "checkAdmission");
    const original = jest.fn(async (_i: unknown, _o: unknown) => "OK");
    const tools = { web_search: { execute: original } };
    wrapWithCostGate(tools, WRAP_CTX, () => ({
      costHint: "metered" as const,
      costBearer: "application" as const,
      deferChargeToJob: false,
    }));

    await tools.web_search.execute({}, { toolCallId: "call_sdk_9" });

    expect(spy).toHaveBeenCalledWith(
      expect.objectContaining({
        stationId: "station-1",
        portalId: "portal-1",
        toolCallId: "call_sdk_9",
      })
    );
    spy.mockRestore();
  });
});
