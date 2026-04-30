import { describe, it, expect } from "@jest/globals";

import type { LayoutPlan } from "@portalai/core/contracts";

import { assertSyncEligibleIdentity } from "../../services/sync-eligibility.util.js";

/** Minimal region builder — only the fields the helper inspects. */
function makeRegion(
  id: string,
  identityKind: "column" | "composite" | "rowPosition"
): LayoutPlan["regions"][number] {
  // Cast through unknown — the helper only reads `id` + `identityStrategy.kind`,
  // and assembling a full schema-valid Region in every test case would dwarf
  // the assertions. The full-shape contract lives in region.schema.ts.
  return {
    id,
    identityStrategy: { kind: identityKind, confidence: 0.9 },
  } as unknown as LayoutPlan["regions"][number];
}

function makePlan(
  regions: LayoutPlan["regions"]
): LayoutPlan {
  return { regions } as unknown as LayoutPlan;
}

describe("assertSyncEligibleIdentity", () => {
  it("returns ok for an empty plan (no regions)", () => {
    const out = assertSyncEligibleIdentity(makePlan([]));
    expect(out).toEqual({ ok: true, ineligibleRegionIds: [] });
  });

  it("returns ok when every region uses column identity", () => {
    const out = assertSyncEligibleIdentity(
      makePlan([makeRegion("r1", "column"), makeRegion("r2", "column")])
    );
    expect(out).toEqual({ ok: true, ineligibleRegionIds: [] });
  });

  it("returns ok when every region uses composite identity", () => {
    const out = assertSyncEligibleIdentity(
      makePlan([makeRegion("r1", "composite"), makeRegion("r2", "composite")])
    );
    expect(out).toEqual({ ok: true, ineligibleRegionIds: [] });
  });

  it("returns ok with mixed column + composite", () => {
    const out = assertSyncEligibleIdentity(
      makePlan([makeRegion("r1", "column"), makeRegion("r2", "composite")])
    );
    expect(out).toEqual({ ok: true, ineligibleRegionIds: [] });
  });

  it("flags a single rowPosition region", () => {
    const out = assertSyncEligibleIdentity(
      makePlan([
        makeRegion("r1", "column"),
        makeRegion("r2", "rowPosition"),
      ])
    );
    expect(out).toEqual({ ok: false, ineligibleRegionIds: ["r2"] });
  });

  it("flags every rowPosition region in a mixed plan", () => {
    const out = assertSyncEligibleIdentity(
      makePlan([
        makeRegion("r1", "rowPosition"),
        makeRegion("r2", "column"),
        makeRegion("r3", "rowPosition"),
        makeRegion("r4", "composite"),
      ])
    );
    expect(out).toEqual({
      ok: false,
      ineligibleRegionIds: ["r1", "r3"],
    });
  });

  it("flag check is exact-match on the strategy kind", () => {
    // Defensive — a future identity kind that's a substring of "rowPosition"
    // (e.g. "rowPositionLite") shouldn't be treated as ineligible.
    const region = {
      id: "r1",
      identityStrategy: {
        kind: "rowPositionLite" as unknown as "rowPosition",
        confidence: 0.9,
      },
    } as unknown as LayoutPlan["regions"][number];
    const out = assertSyncEligibleIdentity(makePlan([region]));
    expect(out.ok).toBe(true);
  });
});
