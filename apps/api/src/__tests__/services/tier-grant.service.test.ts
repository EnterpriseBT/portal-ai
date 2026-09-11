/**
 * TierGrantService.apply (#565) — the source-agnostic tier-grant writer.
 *
 * Driven by a FAKE TierGrantSource (no Stripe) to prove the acceptance
 * criterion directly: a second grant source can write `organizations.tier`
 * through `apply()` without touching any downstream code. The Stripe source's
 * own resolve logic is covered by billing.service.handler.test.ts.
 */

import { jest, describe, it, expect, beforeEach } from "@jest/globals";

// ── Mocks ────────────────────────────────────────────────────────────

const mockOrgUpdate =
  jest.fn<(...args: unknown[]) => Promise<Record<string, unknown>>>();
const mockInsertIfNew = jest.fn<(...args: unknown[]) => Promise<boolean>>();
const TX = { __tx: true };

jest.unstable_mockModule("../../services/db.service.js", () => ({
  DbService: {
    repository: {
      organizations: { update: mockOrgUpdate },
      stripeEvents: { insertIfNew: mockInsertIfNew },
    },
    transaction: (fn: (tx: unknown) => Promise<unknown>) => fn(TX),
  },
}));

const { TierGrantService } =
  await import("../../services/tier-grant.service.js");

// ── A fake source, agnostic of Stripe ────────────────────────────────

// The eventRow shape is opaque to apply() (it only hands it to insertIfNew),
// so a sentinel object is enough to assert it flows through untouched.
const EVENT_ROW = { __eventRow: true } as never;

function fakeSource(resolution: unknown) {
  return {
    idempotencyKey: () => "grant-key-1",
    resolve: async () => resolution as never,
  };
}

const GRANT = {
  outcome: "grant",
  organizationId: "org-9",
  changed: true,
  orgUpdate: { tier: "enterprise" },
  eventRow: EVENT_ROW,
};

beforeEach(() => {
  mockOrgUpdate.mockReset().mockResolvedValue({});
  mockInsertIfNew.mockReset().mockResolvedValue(true);
});

// ── Tests ────────────────────────────────────────────────────────────

describe("TierGrantService.apply — source-agnostic", () => {
  it("applied: a changed grant writes the org update + event row in one transaction", async () => {
    const outcome = await TierGrantService.apply(fakeSource(GRANT), {});

    expect(outcome).toBe("applied");
    // dedup row and org write share the SAME transaction client (D2)
    expect(mockInsertIfNew).toHaveBeenCalledWith(EVENT_ROW, TX);
    expect(mockOrgUpdate).toHaveBeenCalledWith(
      "org-9",
      { tier: "enterprise" },
      TX
    );
  });

  it("noop: an unchanged grant records the row but never writes the org", async () => {
    const outcome = await TierGrantService.apply(
      fakeSource({ ...GRANT, changed: false }),
      {}
    );

    expect(outcome).toBe("noop");
    expect(mockInsertIfNew).toHaveBeenCalledWith(EVENT_ROW, TX);
    expect(mockOrgUpdate).not.toHaveBeenCalled();
  });

  it("duplicate: a redelivered grant (insertIfNew false) writes nothing", async () => {
    mockInsertIfNew.mockResolvedValue(false);

    const outcome = await TierGrantService.apply(fakeSource(GRANT), {});

    expect(outcome).toBe("duplicate");
    expect(mockOrgUpdate).not.toHaveBeenCalled();
  });

  it("unmatched: recorded outside a transaction, no org write", async () => {
    const outcome = await TierGrantService.apply(
      fakeSource({ outcome: "unmatched", eventRow: EVENT_ROW }),
      {}
    );

    expect(outcome).toBe("unmatched");
    expect(mockInsertIfNew).toHaveBeenCalledWith(EVENT_ROW);
    expect(mockOrgUpdate).not.toHaveBeenCalled();
  });

  it("unmatched + redelivery returns duplicate", async () => {
    mockInsertIfNew.mockResolvedValue(false);

    const outcome = await TierGrantService.apply(
      fakeSource({ outcome: "unmatched", eventRow: EVENT_ROW }),
      {}
    );

    expect(outcome).toBe("duplicate");
  });

  it("foreign: recorded, no org write", async () => {
    const outcome = await TierGrantService.apply(
      fakeSource({ outcome: "foreign", eventRow: EVENT_ROW }),
      {}
    );

    expect(outcome).toBe("foreign");
    expect(mockInsertIfNew).toHaveBeenCalledWith(EVENT_ROW);
    expect(mockOrgUpdate).not.toHaveBeenCalled();
  });
});
