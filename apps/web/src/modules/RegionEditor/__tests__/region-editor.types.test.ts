import { describe, it, expect } from "@jest/globals";

import {
  BoundsModeEnum,
  HeaderAxisEnum,
  OrientationEnum,
  SkipRuleSchema,
  WarningCode as CanonicalWarningCode,
  type BoundsMode as CanonicalBoundsMode,
  type HeaderAxis as CanonicalHeaderAxis,
  type Orientation as CanonicalOrientation,
  type SkipRule as CanonicalSkipRule,
  type WarningCode as CanonicalWarningCodeType,
} from "@portalai/core/contracts";

import type {
  BoundsMode,
  HeaderAxis,
  Orientation,
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

const _orientationsAligned: AssertEqual<Orientation, CanonicalOrientation> =
  true;
const _headerAxesAligned: AssertEqual<HeaderAxis, CanonicalHeaderAxis> = true;
const _boundsModesAligned: AssertEqual<BoundsMode, CanonicalBoundsMode> = true;
const _skipRulesAligned: AssertEqual<SkipRule, CanonicalSkipRule> = true;
const _warningCodesAligned: AssertEqual<WarningCode, CanonicalWarningCodeType> =
  true;
void _orientationsAligned;
void _headerAxesAligned;
void _boundsModesAligned;
void _skipRulesAligned;
void _warningCodesAligned;

describe("region-editor.types canonical derivation", () => {
  it("frontend Orientation matches the parser module's union at runtime", () => {
    const values: Orientation[] =
      OrientationEnum.options.slice() as Orientation[];
    expect(values).toEqual(
      expect.arrayContaining([
        "rows-as-records",
        "columns-as-records",
        "cells-as-records",
      ])
    );
  });

  it("frontend HeaderAxis matches the parser module's union at runtime", () => {
    const values: HeaderAxis[] = HeaderAxisEnum.options.slice() as HeaderAxis[];
    expect(values).toEqual(expect.arrayContaining(["row", "column", "none"]));
  });

  it("frontend BoundsMode matches the parser module's union at runtime", () => {
    const values: BoundsMode[] = BoundsModeEnum.options.slice() as BoundsMode[];
    expect(values).toEqual(
      expect.arrayContaining(["absolute", "untilEmpty", "matchesPattern"])
    );
  });

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

  it("RegionDraft compiles with canonical-derived enums", () => {
    const draft: RegionDraft = {
      id: "r1",
      sheetId: "s1",
      bounds: { startRow: 1, endRow: 10, startCol: 1, endCol: 5 },
      targetEntityDefinitionId: null,
      orientation: "rows-as-records",
      headerAxis: "row",
    };
    // Existence + shape check — passes iff the file compiles.
    expect(draft.id).toBe("r1");
  });
});
