import {
  hasRegionErrors,
  regionsWithErrors,
  validateBindingDraft,
  validateRegion,
  validateRegionBindings,
  validateRegions,
} from "../utils/region-editor-validation.util";
import type { RegionDraft } from "../utils/region-editor.types";

function baseRegion(overrides: Partial<RegionDraft> = {}): RegionDraft {
  return {
    id: "r1",
    sheetId: "s1",
    bounds: { startRow: 0, endRow: 4, startCol: 0, endCol: 3 },
    orientation: "rows-as-records",
    headerAxis: "row",
    targetEntityDefinitionId: "ent_contact",
    ...overrides,
  };
}

describe("validateRegion — bounds", () => {
  test("accepts a well-formed standard region", () => {
    const errors = validateRegion(baseRegion());
    expect(errors).toEqual({});
  });

  test("flags inverted row bounds", () => {
    const errors = validateRegion(
      baseRegion({ bounds: { startRow: 5, endRow: 2, startCol: 0, endCol: 3 } })
    );
    expect(errors["bounds.endRow"]).toMatch(/≤ endRow/);
  });

  test("flags inverted column bounds", () => {
    const errors = validateRegion(
      baseRegion({ bounds: { startRow: 0, endRow: 4, startCol: 5, endCol: 2 } })
    );
    expect(errors["bounds.endCol"]).toMatch(/≤ endCol/);
  });

  test("flags negative coordinates", () => {
    const errors = validateRegion(
      baseRegion({
        bounds: { startRow: -1, endRow: 4, startCol: 0, endCol: 3 },
      })
    );
    expect(Object.keys(errors).some((k) => k.startsWith("bounds."))).toBe(true);
  });
});

describe("validateRegion — target entity", () => {
  test("flags missing target entity", () => {
    const errors = validateRegion(
      baseRegion({ targetEntityDefinitionId: null })
    );
    expect(errors.targetEntityDefinitionId).toMatch(/required/i);
  });
});

describe("validateRegion — pivoted regions require a records-axis name", () => {
  test("columns-as-records + headerAxis:row requires recordsAxisName", () => {
    const errors = validateRegion(
      baseRegion({
        orientation: "columns-as-records",
        headerAxis: "row",
      })
    );
    expect(errors.recordsAxisName).toMatch(/required/i);
  });

  test("rows-as-records + headerAxis:column requires recordsAxisName", () => {
    const errors = validateRegion(
      baseRegion({
        orientation: "rows-as-records",
        headerAxis: "column",
      })
    );
    expect(errors.recordsAxisName).toMatch(/required/i);
  });

  test("pivoted region with provided name passes", () => {
    const errors = validateRegion(
      baseRegion({
        orientation: "columns-as-records",
        headerAxis: "row",
        recordsAxisName: { name: "Month", source: "user" },
      })
    );
    expect(errors.recordsAxisName).toBeUndefined();
  });

  test("non-pivoted region does not require axis name", () => {
    const errors = validateRegion(baseRegion());
    expect(errors.recordsAxisName).toBeUndefined();
  });
});

describe("validateRegion — crosstab requires three axis fields", () => {
  test("missing row-axis name, column-axis name, and cell value name", () => {
    const errors = validateRegion(
      baseRegion({ orientation: "cells-as-records", headerAxis: "row" })
    );
    expect(errors.recordsAxisName).toMatch(/row-axis|crosstab/i);
    expect(errors.secondaryRecordsAxisName).toMatch(/column-axis|crosstab/i);
    expect(errors.cellValueName).toMatch(/cell value|crosstab/i);
  });

  test("complete crosstab passes", () => {
    const errors = validateRegion(
      baseRegion({
        orientation: "cells-as-records",
        headerAxis: "row",
        recordsAxisName: { name: "Region", source: "user" },
        secondaryRecordsAxisName: { name: "Month", source: "user" },
        cellValueName: { name: "Revenue", source: "user" },
      })
    );
    expect(errors).toEqual({});
  });
});

describe("validateRegion — extent", () => {
  test("matchesPattern requires a stop pattern", () => {
    const errors = validateRegion(baseRegion({ boundsMode: "matchesPattern" }));
    expect(errors.boundsPattern).toMatch(/required/i);
  });

  test("matchesPattern rejects invalid regex", () => {
    const errors = validateRegion(
      baseRegion({ boundsMode: "matchesPattern", boundsPattern: "([unclosed" })
    );
    expect(errors.boundsPattern).toMatch(/valid regular expression/i);
  });

  test("matchesPattern accepts valid regex", () => {
    const errors = validateRegion(
      baseRegion({ boundsMode: "matchesPattern", boundsPattern: "^Total$" })
    );
    expect(errors.boundsPattern).toBeUndefined();
  });

  test("untilEmpty rejects terminator count of 0", () => {
    const errors = validateRegion(
      baseRegion({ boundsMode: "untilEmpty", untilEmptyTerminatorCount: 0 })
    );
    expect(errors.untilEmptyTerminatorCount).toMatch(/at least 1/i);
  });

  test("untilEmpty accepts undefined terminator count (uses default)", () => {
    const errors = validateRegion(baseRegion({ boundsMode: "untilEmpty" }));
    expect(errors.untilEmptyTerminatorCount).toBeUndefined();
  });
});

describe("validateRegion — skip rules", () => {
  test("accepts a blank skip rule", () => {
    const errors = validateRegion(
      baseRegion({ skipRules: [{ kind: "blank" }] })
    );
    expect(errors).toEqual({});
  });

  test("flags cellMatches rule with empty pattern", () => {
    const errors = validateRegion(
      baseRegion({
        skipRules: [{ kind: "cellMatches", crossAxisIndex: 0, pattern: "" }],
      })
    );
    expect(errors["skipRules.0.pattern"]).toMatch(/required/i);
  });

  test("flags cellMatches rule with invalid regex", () => {
    const errors = validateRegion(
      baseRegion({
        skipRules: [
          { kind: "cellMatches", crossAxisIndex: 0, pattern: "([oops" },
        ],
      })
    );
    expect(errors["skipRules.0.pattern"]).toMatch(/valid regular expression/i);
  });

  test("flags cellMatches rule with no row/column selected", () => {
    const errors = validateRegion(
      baseRegion({
        skipRules: [
          { kind: "cellMatches", crossAxisIndex: undefined, pattern: "^x$" },
        ],
      })
    );
    expect(errors["skipRules.0.crossAxisIndex"]).toMatch(/required/i);
  });

  test("reports both missing position and empty pattern on the same rule", () => {
    const errors = validateRegion(
      baseRegion({
        skipRules: [
          { kind: "cellMatches", crossAxisIndex: undefined, pattern: "" },
        ],
      })
    );
    expect(errors["skipRules.0.crossAxisIndex"]).toMatch(/required/i);
    expect(errors["skipRules.0.pattern"]).toMatch(/required/i);
  });

  test("accepts multiple valid skip rules", () => {
    const errors = validateRegion(
      baseRegion({
        skipRules: [
          { kind: "blank" },
          { kind: "cellMatches", crossAxisIndex: 0, pattern: "^—.*—$" },
        ],
      })
    );
    expect(errors).toEqual({});
  });
});

describe("validateRegion — axisAnchorCell override", () => {
  const pivotedBase = baseRegion({
    orientation: "rows-as-records",
    headerAxis: "column",
    bounds: { startRow: 3, endRow: 7, startCol: 0, endCol: 4 },
    recordsAxisName: { name: "Region", source: "user" },
  });

  test("accepts an anchor within bounds on a pivoted region", () => {
    const errors = validateRegion({
      ...pivotedBase,
      axisAnchorCell: { row: 7, col: 0 },
    });
    expect(errors.axisAnchorCell).toBeUndefined();
  });

  test("flags an anchor outside bounds", () => {
    const errors = validateRegion({
      ...pivotedBase,
      axisAnchorCell: { row: 2, col: 0 },
    });
    expect(errors.axisAnchorCell).toMatch(/within the region's bounds/);
  });

  test("flags an anchor with negative coordinates", () => {
    const errors = validateRegion({
      ...pivotedBase,
      axisAnchorCell: { row: -1, col: 0 },
    });
    expect(errors.axisAnchorCell).toMatch(/non-negative integers/);
  });

  test("flags an anchor set on a non-pivoted region", () => {
    const errors = validateRegion({
      ...baseRegion(),
      axisAnchorCell: { row: 0, col: 0 },
    });
    expect(errors.axisAnchorCell).toMatch(/only applies to pivoted regions/);
  });
});

describe("validateRegions — multi-region", () => {
  const good = baseRegion({ id: "ok" });
  const bad = baseRegion({ id: "bad", targetEntityDefinitionId: null });

  test("returns only failing regions", () => {
    const result = validateRegions([good, bad]);
    expect(result["ok"]).toBeUndefined();
    expect(result["bad"]).toBeDefined();
  });

  test("hasRegionErrors reflects presence of errors", () => {
    expect(hasRegionErrors(validateRegions([good]))).toBe(false);
    expect(hasRegionErrors(validateRegions([good, bad]))).toBe(true);
  });

  test("regionsWithErrors returns failing ids in input order", () => {
    const result = validateRegions([bad, good]);
    expect(regionsWithErrors([bad, good], result)).toEqual(["bad"]);
  });
});

describe("validateBindingDraft — single binding", () => {
  const baseBinding = {
    sourceLocator: "header:Email",
    columnDefinitionId: "coldef_email",
    confidence: 0.9,
  };

  test("accepts a baseline binding with no overrides", () => {
    expect(validateBindingDraft(baseBinding)).toEqual({});
  });

  test("flags a normalizedKey that violates the regex", () => {
    expect(
      validateBindingDraft({ ...baseBinding, normalizedKey: "Bad Key" })
    ).toMatchObject({ normalizedKey: expect.any(String) });
  });

  test("accepts valid normalizedKey overrides", () => {
    expect(
      validateBindingDraft({ ...baseBinding, normalizedKey: "email_override" })
    ).toEqual({});
  });

  test("flags reference-typed binding without refEntityKey", () => {
    expect(
      validateBindingDraft(baseBinding, { columnDefinitionType: "reference" })
    ).toMatchObject({ refEntityKey: expect.any(String) });
  });

  test("reference-typed binding with refEntityKey passes", () => {
    expect(
      validateBindingDraft(
        { ...baseBinding, refEntityKey: "customers" },
        { columnDefinitionType: "reference" }
      )
    ).toEqual({});
  });

  test("does NOT flag excluded bindings for missing columnDefinitionId / refEntityKey", () => {
    expect(
      validateBindingDraft(
        {
          ...baseBinding,
          columnDefinitionId: null,
          excluded: true,
        },
        { columnDefinitionType: "reference" }
      )
    ).toEqual({});
  });
});

describe("validateRegionBindings — cross-binding collisions", () => {
  function makeBinding(
    sourceLocator: string,
    overrides: Partial<
      import("../utils/region-editor.types").ColumnBindingDraft
    > = {}
  ) {
    return {
      sourceLocator,
      columnDefinitionId: `coldef_${sourceLocator}`,
      confidence: 0.9,
      ...overrides,
    };
  }

  test("returns an empty map when bindings are valid", () => {
    const region = baseRegion({
      columnBindings: [
        makeBinding("header:Email", { normalizedKey: "email" }),
        makeBinding("header:Name", { normalizedKey: "name" }),
      ],
    });
    expect(validateRegionBindings(region)).toEqual({});
  });

  test("flags two bindings with the same normalizedKey override", () => {
    const region = baseRegion({
      columnBindings: [
        makeBinding("header:Email", { normalizedKey: "dup_key" }),
        makeBinding("header:Name", { normalizedKey: "dup_key" }),
      ],
    });
    const errors = validateRegionBindings(region);
    expect(errors["header:Email"]?.normalizedKey).toMatch(/duplicate/i);
    expect(errors["header:Name"]?.normalizedKey).toMatch(/duplicate/i);
  });

  test("excluded bindings don't participate in collision detection", () => {
    const region = baseRegion({
      columnBindings: [
        makeBinding("header:Email", { normalizedKey: "dup_key" }),
        makeBinding("header:Name", {
          normalizedKey: "dup_key",
          excluded: true,
        }),
      ],
    });
    const errors = validateRegionBindings(region);
    expect(errors["header:Email"]).toBeUndefined();
    expect(errors["header:Name"]).toBeUndefined();
  });

  test("returns errors keyed by sourceLocator for each failing binding", () => {
    const region = baseRegion({
      columnBindings: [
        makeBinding("header:A", { normalizedKey: "Bad Key" }),
        makeBinding("col:2", { normalizedKey: "good_key" }),
      ],
    });
    const errors = validateRegionBindings(region);
    expect(errors["header:A"]?.normalizedKey).toBeDefined();
    expect(errors["col:2"]).toBeUndefined();
  });
});
