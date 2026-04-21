import { describe, it, expect } from "@jest/globals";

import type { RegionDraft, Workbook } from "../../../modules/RegionEditor";

import type { LayoutPlan } from "@portalai/core/contracts";

import {
  entityOptionsFromWorkbook,
  mergeStagedEntityOptions,
  overallConfidenceFromPlan,
  planRegionsToDrafts,
  preserveUserRegionConfig,
  regionDraftsToHints,
  workbookToBackend,
} from "../utils/layout-plan-mapping.util";

const makeWorkbook = (): Workbook => ({
  sheets: [
    {
      id: "sheet_a",
      name: "Alpha",
      rowCount: 3,
      colCount: 2,
      cells: [
        ["Name", "Email"],
        ["Alice", "alice@example.com"],
        ["Bob", "bob@example.com"],
      ],
    },
    {
      id: "sheet_b",
      name: "Beta",
      rowCount: 2,
      colCount: 1,
      cells: [["onlyvalue"], [42]],
    },
  ],
});

const baseDraft = (overrides: Partial<RegionDraft> = {}): RegionDraft => ({
  id: "r1",
  sheetId: "sheet_a",
  bounds: { startRow: 0, endRow: 2, startCol: 0, endCol: 1 },
  orientation: "rows-as-records",
  headerAxis: "row",
  targetEntityDefinitionId: "ent_contact",
  ...overrides,
});

describe("regionDraftsToHints", () => {
  it("returns [] for empty input", () => {
    expect(regionDraftsToHints(makeWorkbook(), [])).toEqual([]);
  });

  it("resolves sheetId to the workbook's sheet name", () => {
    const hints = regionDraftsToHints(makeWorkbook(), [baseDraft()]);
    expect(hints).toHaveLength(1);
    expect(hints[0].sheet).toBe("Alpha");
  });

  it("drops drafts missing a bound entity", () => {
    const hints = regionDraftsToHints(makeWorkbook(), [
      baseDraft(),
      baseDraft({ id: "r2", targetEntityDefinitionId: null }),
    ]);
    expect(hints).toHaveLength(1);
    expect(hints[0].targetEntityDefinitionId).toBe("ent_contact");
  });

  it("passes optional axis-name + anchor fields through (anchor converted 0→1-indexed)", () => {
    const hints = regionDraftsToHints(makeWorkbook(), [
      baseDraft({
        recordsAxisName: { name: "Quarter", source: "user" },
        secondaryRecordsAxisName: { name: "Region", source: "user" },
        cellValueName: { name: "Revenue", source: "user" },
        axisAnchorCell: { row: 2, col: 1 },
        proposedLabel: "Quarterly fact",
      }),
    ]);
    expect(hints[0]).toEqual(
      expect.objectContaining({
        recordsAxisName: "Quarter",
        secondaryRecordsAxisName: "Region",
        cellValueName: "Revenue",
        axisAnchorCell: { row: 3, col: 2 },
        proposedLabel: "Quarterly fact",
      })
    );
  });

  it("converts 0-indexed frontend bounds to 1-indexed backend bounds", () => {
    const hints = regionDraftsToHints(makeWorkbook(), [
      baseDraft({
        bounds: { startRow: 0, endRow: 4, startCol: 0, endCol: 34 },
      }),
    ]);
    expect(hints[0].bounds).toEqual({
      startRow: 1,
      endRow: 5,
      startCol: 1,
      endCol: 35,
    });
  });

  it("throws when a draft's sheetId cannot be resolved", () => {
    expect(() =>
      regionDraftsToHints(makeWorkbook(), [
        baseDraft({ sheetId: "sheet_missing" }),
      ])
    ).toThrow(/sheet_missing/);
  });
});

describe("planRegionsToDrafts", () => {
  // Narrow plan-shaped fixture — `planRegionsToDrafts` only reads fields
  // enumerated in this fixture, so we skip the full LayoutPlan envelope.
  const plan = {
    regions: [
      {
        id: "ignored_by_mapper",
        sheet: "Alpha",
        bounds: { startRow: 1, endRow: 3, startCol: 1, endCol: 2 },
        boundsMode: "absolute" as const,
        orientation: "rows-as-records" as const,
        headerAxis: "row" as const,
        targetEntityDefinitionId: "ent_contact",
        identityStrategy: { kind: "rowPosition" as const, confidence: 0.9 },
        columnBindings: [
          {
            sourceLocator: { kind: "byHeaderName" as const, name: "Name" },
            columnDefinitionId: "coldef_name",
            confidence: 0.95,
          },
          {
            sourceLocator: { kind: "byColumnIndex" as const, col: 2 },
            columnDefinitionId: "coldef_email",
            confidence: 0.7,
            rationale: "matched by position",
          },
        ],
        skipRules: [],
        drift: { boundsPolicy: "auto" as const },
        confidence: { region: 0.9, aggregate: 0.85 },
        warnings: [],
      },
    ],
    confidence: {
      overall: 0.85,
      perRegion: { ignored_by_mapper: 0.85 },
    },
  } as unknown as Parameters<typeof planRegionsToDrafts>[0];

  it("produces one draft per plan region", () => {
    const drafts = planRegionsToDrafts(plan, makeWorkbook());
    expect(drafts).toHaveLength(1);
  });

  it("resolves the plan's sheet name back to the workbook sheetId", () => {
    const drafts = planRegionsToDrafts(plan, makeWorkbook());
    expect(drafts[0].sheetId).toBe("sheet_a");
  });

  it("converts 1-indexed backend bounds to 0-indexed frontend bounds", () => {
    const drafts = planRegionsToDrafts(plan, makeWorkbook());
    expect(drafts[0].bounds).toEqual({
      startRow: 0,
      endRow: 2,
      startCol: 0,
      endCol: 1,
    });
  });

  it("mints deterministic ids from (sheet, bounds)", () => {
    const first = planRegionsToDrafts(plan, makeWorkbook())[0].id;
    const second = planRegionsToDrafts(plan, makeWorkbook())[0].id;
    expect(first).toBe(second);
    expect(first).toContain("sheet_a");
  });

  it("maps backend ColumnBinding locators into frontend string sourceLocators", () => {
    const drafts = planRegionsToDrafts(plan, makeWorkbook());
    const bindings = drafts[0].columnBindings ?? [];
    expect(bindings).toHaveLength(2);
    expect(bindings[0].sourceLocator).toBe("header:Name");
    expect(bindings[1].sourceLocator).toBe("col:2");
  });

  it("copies confidence (region aggregate) and warnings through", () => {
    const drafts = planRegionsToDrafts(plan, makeWorkbook());
    expect(drafts[0].confidence).toBe(0.85);
    expect(drafts[0].warnings).toEqual([]);
  });

  it("throws when the plan references a sheet name not in the workbook", () => {
    const bad = {
      ...plan,
      regions: [{ ...plan.regions[0], sheet: "NoSuchSheet" }],
    } as unknown as Parameters<typeof planRegionsToDrafts>[0];
    expect(() => planRegionsToDrafts(bad, makeWorkbook())).toThrow(
      /NoSuchSheet/
    );
  });
});

describe("preserveUserRegionConfig", () => {
  const baseRegion: LayoutPlan["regions"][number] = {
    id: "region-1",
    sheet: "Alpha",
    bounds: { startRow: 1, endRow: 3, startCol: 1, endCol: 2 },
    boundsMode: "absolute",
    orientation: "rows-as-records",
    headerAxis: "row",
    targetEntityDefinitionId: "ent_contact",
    identityStrategy: { kind: "rowPosition", confidence: 0.9 },
    columnBindings: [],
    skipRules: [],
    drift: {
      headerShiftRows: 0,
      addedColumns: "halt",
      removedColumns: { max: 0, action: "halt" },
    },
    confidence: { region: 0.9, aggregate: 0.85 },
    warnings: [],
  };
  const basePlan: LayoutPlan = {
    planVersion: "1.0.0",
    workbookFingerprint: {
      sheetNames: ["Alpha"],
      dimensions: { Alpha: { rows: 3, cols: 2 } },
      anchorCells: [],
    },
    regions: [baseRegion],
    confidence: { overall: 0.85, perRegion: { "region-1": 0.85 } },
  };

  it("overrides boundsMode with the prior draft's user selection", () => {
    const result = preserveUserRegionConfig(basePlan, [
      baseDraft({ boundsMode: "untilEmpty" }),
    ]);
    expect(result.regions[0].boundsMode).toBe("untilEmpty");
  });

  it("copies boundsPattern, untilEmptyTerminatorCount, columnOverrides", () => {
    const result = preserveUserRegionConfig(basePlan, [
      baseDraft({
        boundsMode: "matchesPattern",
        boundsPattern: "^Totals$",
        untilEmptyTerminatorCount: 4,
        columnOverrides: { columnA: "customerName" },
      }),
    ]);
    expect(result.regions[0]).toMatchObject({
      boundsMode: "matchesPattern",
      boundsPattern: "^Totals$",
      untilEmptyTerminatorCount: 4,
      columnOverrides: { columnA: "customerName" },
    });
  });

  it("maps draft skip rules, dropping cellMatches rules without a crossAxisIndex", () => {
    const result = preserveUserRegionConfig(basePlan, [
      baseDraft({
        skipRules: [
          { kind: "blank" },
          { kind: "cellMatches", crossAxisIndex: 2, pattern: "^total" },
          // Mid-edit — no crossAxisIndex yet. Must be dropped so we don't
          // violate the backend schema's nonnegative-integer requirement.
          { kind: "cellMatches", crossAxisIndex: undefined, pattern: "X" },
        ],
      }),
    ]);
    expect(result.regions[0].skipRules).toEqual([
      { kind: "blank" },
      { kind: "cellMatches", crossAxisIndex: 2, pattern: "^total" },
    ]);
  });

  it("aligns drafts to plan regions by index, skipping drafts without an entity", () => {
    const twoRegionPlan: LayoutPlan = {
      ...basePlan,
      regions: [
        baseRegion,
        { ...baseRegion, id: "region-2", bounds: baseRegion.bounds },
      ],
    };
    const result = preserveUserRegionConfig(twoRegionPlan, [
      baseDraft({ targetEntityDefinitionId: null }), // dropped by filter
      baseDraft({ boundsMode: "untilEmpty" }),
      baseDraft({ boundsMode: "matchesPattern", boundsPattern: "END" }),
    ]);
    expect(result.regions[0].boundsMode).toBe("untilEmpty");
    expect(result.regions[1].boundsMode).toBe("matchesPattern");
    expect(result.regions[1].boundsPattern).toBe("END");
  });

  it("returns the plan unchanged when no drafts have a target entity", () => {
    const result = preserveUserRegionConfig(basePlan, [
      baseDraft({ targetEntityDefinitionId: null }),
    ]);
    expect(result).toBe(basePlan);
  });
});

describe("overallConfidenceFromPlan", () => {
  it("returns plan.confidence.overall", () => {
    expect(
      overallConfidenceFromPlan({
        confidence: { overall: 0.42, perRegion: {} },
      })
    ).toBe(0.42);
  });
});

describe("workbookToBackend", () => {
  it("converts dense cells to sparse 1-based WorkbookCell tuples", () => {
    const wb = workbookToBackend(makeWorkbook());
    expect(wb.sheets).toHaveLength(2);

    const alpha = wb.sheets[0];
    expect(alpha.name).toBe("Alpha");
    expect(alpha.dimensions).toEqual({ rows: 3, cols: 2 });
    expect(alpha.cells).toEqual(
      expect.arrayContaining([
        { row: 1, col: 1, value: "Name" },
        { row: 1, col: 2, value: "Email" },
        { row: 3, col: 2, value: "bob@example.com" },
      ])
    );

    const beta = wb.sheets[1];
    expect(beta.cells).toEqual(
      expect.arrayContaining([
        { row: 1, col: 1, value: "onlyvalue" },
        { row: 2, col: 1, value: 42 },
      ])
    );
  });

  it("skips empty strings and null cells", () => {
    const wb = workbookToBackend({
      sheets: [
        {
          id: "s",
          name: "S",
          rowCount: 2,
          colCount: 3,
          cells: [
            ["a", "", "b"],
            [null, null, null],
          ],
        },
      ],
    });
    const cells = wb.sheets[0].cells;
    expect(cells).toHaveLength(2);
    expect(cells).toEqual(
      expect.arrayContaining([
        { row: 1, col: 1, value: "a" },
        { row: 1, col: 3, value: "b" },
      ])
    );
  });
});

describe("entityOptionsFromWorkbook", () => {
  it("returns [] for a null workbook", () => {
    expect(entityOptionsFromWorkbook(null)).toEqual([]);
  });

  it("produces one staged option per sheet using sheet name as label and id as value", () => {
    const options = entityOptionsFromWorkbook(makeWorkbook());
    expect(options).toEqual([
      { value: "sheet_a", label: "Alpha", source: "staged" },
      { value: "sheet_b", label: "Beta", source: "staged" },
    ]);
  });

  it("preserves sheet order", () => {
    const options = entityOptionsFromWorkbook({
      sheets: [
        { id: "z", name: "Z", rowCount: 1, colCount: 1, cells: [["x"]] },
        { id: "a", name: "A", rowCount: 1, colCount: 1, cells: [["y"]] },
      ],
    });
    expect(options.map((o) => o.label)).toEqual(["Z", "A"]);
  });

  it("flags every option as 'staged' so the editor knows they're not DB-backed", () => {
    const options = entityOptionsFromWorkbook(makeWorkbook());
    expect(options.every((o) => o.source === "staged")).toBe(true);
  });
});

describe("mergeStagedEntityOptions", () => {
  const sheetOptions = entityOptionsFromWorkbook(makeWorkbook());

  it("returns sheet options unchanged when no extras are staged", () => {
    expect(mergeStagedEntityOptions(sheetOptions, [])).toEqual(sheetOptions);
  });

  it("appends staged extras after sheet options in insertion order", () => {
    const merged = mergeStagedEntityOptions(sheetOptions, [
      { value: "custom_a", label: "Custom A", source: "staged" },
      { value: "custom_b", label: "Custom B", source: "staged" },
    ]);
    expect(merged.map((o) => o.value)).toEqual([
      "sheet_a",
      "sheet_b",
      "custom_a",
      "custom_b",
    ]);
  });

  it("drops staged entries that collide with a sheet option's value", () => {
    const merged = mergeStagedEntityOptions(sheetOptions, [
      { value: "sheet_a", label: "Renamed", source: "staged" },
      { value: "custom_x", label: "Custom X", source: "staged" },
    ]);
    expect(merged.map((o) => o.value)).toEqual([
      "sheet_a",
      "sheet_b",
      "custom_x",
    ]);
    // Sheet option keeps its original label.
    expect(merged.find((o) => o.value === "sheet_a")?.label).toBe("Alpha");
  });
});
