import { describe, it, expect } from "@jest/globals";

import {
  SkipRuleSchema,
  WarningCode as CanonicalWarningCode,
  type SkipRule as CanonicalSkipRule,
  type WarningCode as CanonicalWarningCodeType,
} from "@portalai/core/contracts";

import type {
  RegionDraft,
  SkipRule,
  WarningCode,
} from "../utils/region-editor.types";

// ── Compile-time identity assertions ──────────────────────────────────────
// If any of these fail to compile, the draft/UI types have drifted away from
// the canonical parser-module types and need to be re-derived.

type AssertEqual<A, B> =
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2
    ? true
    : false;

const _skipRulesAligned: AssertEqual<SkipRule, CanonicalSkipRule> = true;
const _warningCodesAligned: AssertEqual<WarningCode, CanonicalWarningCodeType> =
  true;
void _skipRulesAligned;
void _warningCodesAligned;

describe("region-editor.types canonical derivation", () => {
  it("frontend SkipRule parses through the canonical SkipRuleSchema", () => {
    const rule: SkipRule = { kind: "blank" };
    expect(SkipRuleSchema.safeParse(rule).success).toBe(true);

    const cellMatches: SkipRule = {
      kind: "cellMatches",
      crossAxisIndex: 0,
      pattern: "^Total$",
    };
    expect(SkipRuleSchema.safeParse(cellMatches).success).toBe(true);
  });

  it("frontend WarningCode re-export is the parser module's const object", () => {
    const code: WarningCode = "AMBIGUOUS_HEADER";
    expect(CanonicalWarningCode[code]).toBe("AMBIGUOUS_HEADER");
  });

  it("RegionDraft compiles with the PR-1 draft unions", () => {
    const draft: RegionDraft = {
      id: "r1",
      sheetId: "s1",
      bounds: { startRow: 1, endRow: 10, startCol: 1, endCol: 5 },
      targetEntityDefinitionId: null,
      orientation: "rows-as-records",
      headerAxis: "row",
    };
    expect(draft.id).toBe("r1");
  });
});
