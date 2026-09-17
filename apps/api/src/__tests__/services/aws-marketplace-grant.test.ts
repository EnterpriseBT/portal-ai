/**
 * AwsMarketplaceGrantSource (#568) — the marketplace entitlement resolver.
 *
 * MarketplaceService (converge read + tier map + row builder) and db.service
 * are mocked, so `resolve` is asserted as a pure function of the entitlement +
 * the current org, and `apply` is exercised for idempotency via the reused D2
 * transaction.
 */
import { jest, describe, it, expect, beforeEach } from "@jest/globals";

const mockGetEntitlement =
  jest.fn<() => Promise<Record<string, unknown> | null>>();
const mockEventRow = jest.fn(
  (_n: unknown, fields: Record<string, unknown>) => ({ __row: true, ...fields })
);

jest.unstable_mockModule("../../services/marketplace.service.js", () => ({
  MarketplaceService: {
    getEntitlement: mockGetEntitlement,
    dimensionToTier: (d: string) => {
      if (d === "enterprise") return "enterprise";
      throw new Error(`Unknown AWS Marketplace dimension: ${d}`);
    },
    eventRow: mockEventRow,
  },
}));

const mockFindSole =
  jest.fn<() => Promise<Record<string, unknown> | undefined>>();
const mockOrgUpdate =
  jest.fn<(...a: unknown[]) => Promise<Record<string, unknown>>>();
const mockInsertIfNew = jest.fn<(...a: unknown[]) => Promise<boolean>>();
const TX = { __tx: true };

jest.unstable_mockModule("../../services/db.service.js", () => ({
  DbService: {
    repository: {
      organizations: { findSole: mockFindSole, update: mockOrgUpdate },
      commercialEvents: { insertIfNew: mockInsertIfNew },
    },
    transaction: (fn: (tx: unknown) => Promise<unknown>) => fn(TX),
  },
}));

const { TierGrantService, AwsMarketplaceGrantSource } =
  await import("../../services/tier-grant.service.js");

const NOTIFICATION = { MessageId: "msg-1", action: "entitlement-updated" };
const FUTURE = 1_900_000_000_000;

beforeEach(() => {
  jest.clearAllMocks();
  mockOrgUpdate.mockResolvedValue({});
  mockInsertIfNew.mockResolvedValue(true);
});

describe("AwsMarketplaceGrantSource.resolve (#568)", () => {
  it("case 10 — a fresh entitlement grants the tier + term", async () => {
    mockFindSole.mockResolvedValue({
      id: "org-1",
      tier: "standard",
      marketplaceEntitlementId: null,
      entitlementThrough: null,
    });
    mockGetEntitlement.mockResolvedValue({
      customerIdentifier: "cust-1",
      dimension: "enterprise",
      expirationDate: FUTURE,
    });

    const res = await new AwsMarketplaceGrantSource().resolve(NOTIFICATION);

    expect(res.outcome).toBe("grant");
    if (res.outcome !== "grant") throw new Error("expected grant");
    expect(res.organizationId).toBe("org-1");
    expect(res.changed).toBe(true);
    expect(res.orgUpdate).toMatchObject({
      tier: "enterprise",
      marketplaceEntitlementId: "cust-1",
      entitlementThrough: FUTURE,
    });
  });

  it("case 11 — an unchanged entitlement is a noop (changed false)", async () => {
    mockFindSole.mockResolvedValue({
      id: "org-1",
      tier: "enterprise",
      marketplaceEntitlementId: "cust-1",
      entitlementThrough: FUTURE,
    });
    mockGetEntitlement.mockResolvedValue({
      customerIdentifier: "cust-1",
      dimension: "enterprise",
      expirationDate: FUTURE,
    });

    const res = await new AwsMarketplaceGrantSource().resolve(NOTIFICATION);
    expect(res.outcome).toBe("grant");
    if (res.outcome !== "grant") throw new Error("expected grant");
    expect(res.changed).toBe(false);
  });

  it("case 12 — a foreign entitlement is recorded, not applied", async () => {
    mockFindSole.mockResolvedValue({
      id: "org-1",
      tier: "enterprise",
      marketplaceEntitlementId: "cust-OLD",
      entitlementThrough: FUTURE,
    });
    mockGetEntitlement.mockResolvedValue({
      customerIdentifier: "cust-NEW",
      dimension: "enterprise",
      expirationDate: FUTURE,
    });

    const res = await new AwsMarketplaceGrantSource().resolve(NOTIFICATION);
    expect(res.outcome).toBe("foreign");
  });

  it("case 13 — a lapsed entitlement flips read-only, tier unchanged, no data loss", async () => {
    mockFindSole.mockResolvedValue({
      id: "org-1",
      tier: "enterprise",
      marketplaceEntitlementId: "cust-1",
      entitlementThrough: FUTURE, // currently active
    });
    mockGetEntitlement.mockResolvedValue(null); // no active entitlement

    const before = Date.now();
    const res = await new AwsMarketplaceGrantSource().resolve(NOTIFICATION);
    const after = Date.now();

    expect(res.outcome).toBe("grant");
    if (res.outcome !== "grant") throw new Error("expected grant");
    expect(res.changed).toBe(true);
    // term set to now (⇒ derived read-only for any later request); tier UNTOUCHED
    const update = res.orgUpdate as {
      entitlementThrough: number;
      tier?: string;
    };
    expect(update.entitlementThrough).toBeGreaterThanOrEqual(before);
    expect(update.entitlementThrough).toBeLessThanOrEqual(after);
    expect(update.tier).toBeUndefined();
  });

  it("case 13b — a lapsed entitlement on a never-granted org is a noop", async () => {
    mockFindSole.mockResolvedValue({
      id: "org-1",
      tier: "standard",
      marketplaceEntitlementId: null,
      entitlementThrough: null,
    });
    mockGetEntitlement.mockResolvedValue(null);

    const res = await new AwsMarketplaceGrantSource().resolve(NOTIFICATION);
    expect(res.outcome).toBe("grant");
    if (res.outcome !== "grant") throw new Error("expected grant");
    expect(res.changed).toBe(false);
  });

  it("records unmatched when there is no sole org", async () => {
    mockFindSole.mockResolvedValue(undefined);
    mockGetEntitlement.mockResolvedValue({
      customerIdentifier: "cust-1",
      dimension: "enterprise",
      expirationDate: FUTURE,
    });
    const res = await new AwsMarketplaceGrantSource().resolve(NOTIFICATION);
    expect(res.outcome).toBe("unmatched");
  });
});

describe("apply(new AwsMarketplaceGrantSource(), n) (#568, case 14)", () => {
  beforeEach(() => {
    mockFindSole.mockResolvedValue({
      id: "org-1",
      tier: "standard",
      marketplaceEntitlementId: null,
      entitlementThrough: null,
    });
    mockGetEntitlement.mockResolvedValue({
      customerIdentifier: "cust-1",
      dimension: "enterprise",
      expirationDate: FUTURE,
    });
  });

  it("applies a fresh grant through the D2 transaction", async () => {
    const outcome = await TierGrantService.apply(
      new AwsMarketplaceGrantSource(),
      NOTIFICATION
    );
    expect(outcome).toBe("applied");
    expect(mockOrgUpdate).toHaveBeenCalledWith(
      "org-1",
      expect.objectContaining({ tier: "enterprise" }),
      TX
    );
  });

  it("a redelivered MessageId is a duplicate (single row, no org write)", async () => {
    mockInsertIfNew.mockResolvedValue(false);
    const outcome = await TierGrantService.apply(
      new AwsMarketplaceGrantSource(),
      NOTIFICATION
    );
    expect(outcome).toBe("duplicate");
    expect(mockOrgUpdate).not.toHaveBeenCalled();
  });
});
