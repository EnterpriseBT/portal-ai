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
  // The helper now always returns `ok: true` — `rowPosition` regions are
  // surfaced as a non-blocking advisory (`identityWarnings`) rather than a
  // hard refusal. The frontend reads the warnings to render the soft banner
  // (Phase C) but sync proceeds either way.

  it("returns ok with no warnings for an empty plan", () => {
    const out = assertSyncEligibleIdentity(makePlan([]));
    expect(out).toEqual({ ok: true, identityWarnings: [] });
  });

  it("returns ok with no warnings when every region uses column identity", () => {
    const out = assertSyncEligibleIdentity(
      makePlan([makeRegion("r1", "column"), makeRegion("r2", "column")])
    );
    expect(out).toEqual({ ok: true, identityWarnings: [] });
  });

  it("returns ok with no warnings when every region uses composite identity", () => {
    const out = assertSyncEligibleIdentity(
      makePlan([makeRegion("r1", "composite"), makeRegion("r2", "composite")])
    );
    expect(out).toEqual({ ok: true, identityWarnings: [] });
  });

  it("returns ok with no warnings on mixed column + composite", () => {
    const out = assertSyncEligibleIdentity(
      makePlan([makeRegion("r1", "column"), makeRegion("r2", "composite")])
    );
    expect(out).toEqual({ ok: true, identityWarnings: [] });
  });

  it("populates identityWarnings for a single rowPosition region in an otherwise stable plan", () => {
    const out = assertSyncEligibleIdentity(
      makePlan([
        makeRegion("r1", "column"),
        makeRegion("r2", "rowPosition"),
      ])
    );
    expect(out).toEqual({
      ok: true,
      identityWarnings: [{ regionId: "r2" }],
    });
  });

  it("populates identityWarnings for every rowPosition region in plan order", () => {
    const out = assertSyncEligibleIdentity(
      makePlan([
        makeRegion("r1", "rowPosition"),
        makeRegion("r2", "column"),
        makeRegion("r3", "rowPosition"),
        makeRegion("r4", "composite"),
      ])
    );
    expect(out).toEqual({
      ok: true,
      identityWarnings: [{ regionId: "r1" }, { regionId: "r3" }],
    });
  });

  it("flag check is exact-match on the strategy kind", () => {
    // Defensive — a future identity kind that's a substring of "rowPosition"
    // (e.g. "rowPositionLite") shouldn't be treated as a warning source.
    const region = {
      id: "r1",
      identityStrategy: {
        kind: "rowPositionLite" as unknown as "rowPosition",
        confidence: 0.9,
      },
    } as unknown as LayoutPlan["regions"][number];
    const out = assertSyncEligibleIdentity(makePlan([region]));
    expect(out).toEqual({ ok: true, identityWarnings: [] });
  });
});
