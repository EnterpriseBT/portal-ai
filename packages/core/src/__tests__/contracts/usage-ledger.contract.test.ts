import { describe, it, expect } from "@jest/globals";
import {
  UsageLedgerListRequestQuerySchema,
  UsageLedgerListResponseSchema,
} from "../../contracts/usage-ledger.contract.js";

// ── Tests (spec case 2) ──────────────────────────────────────────────

describe("UsageLedgerListRequestQuerySchema", () => {
  it("coerces pagination strings and accepts optional filters", () => {
    const parsed = UsageLedgerListRequestQuerySchema.parse({
      limit: "25",
      offset: "50",
      sortBy: "units",
      sortOrder: "desc",
      periodId: "2026-07",
      toolName: "web_search",
    });

    expect(parsed.limit).toBe(25);
    expect(parsed.offset).toBe(50);
    expect(parsed.periodId).toBe("2026-07");
    expect(parsed.toolName).toBe("web_search");
  });

  it("applies pagination defaults with no filters", () => {
    const parsed = UsageLedgerListRequestQuerySchema.parse({});
    expect(parsed.sortBy).toBe("created");
    expect(parsed.sortOrder).toBe("desc"); // newest-first default

    expect(parsed.periodId).toBeUndefined();
    expect(parsed.toolName).toBeUndefined();
  });
});

describe("UsageLedgerListResponseSchema", () => {
  it("parses a representative page", () => {
    const entry = {
      id: "l-1",
      created: 1_784_000_000_000,
      createdBy: "SYSTEM",
      updated: null,
      updatedBy: null,
      deleted: null,
      deletedBy: null,
      organizationId: "org-1",
      toolName: "web_search",
      toolCallId: "call_1",
      stationId: "station-1",
      portalId: null,
      costClass: "metered",
      units: 1,
      periodId: "2026-07",
      userId: "user-1",
    };

    expect(
      UsageLedgerListResponseSchema.safeParse({ entries: [entry], total: 1 })
        .success
    ).toBe(true);
    expect(
      UsageLedgerListResponseSchema.safeParse({ entries: [], total: 0 }).success
    ).toBe(true);
    expect(
      UsageLedgerListResponseSchema.safeParse({ entries: [entry] }).success
    ).toBe(false); // total required
  });
});
