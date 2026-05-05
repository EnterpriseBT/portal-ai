import { describe, it, expect } from "@jest/globals";

import type { LayoutPlan } from "@portalai/core/contracts";

import { lockPlanIdentityToRowPosition } from "../utils/lock-identity.util";

// ---------------------------------------------------------------------------
// Fixture builders — minimal LayoutPlan / Region shapes for unit testing.
// The helper is pure and walks the tree; we don't need full Zod-valid plans.
// ---------------------------------------------------------------------------

type Region = LayoutPlan["regions"][number];

const baseRegion = (overrides: Partial<Region> = {}): Region => ({
  id: "region-1",
  sheet: "Alpha",
  bounds: { startRow: 1, endRow: 3, startCol: 1, endCol: 2 },
  targetEntityDefinitionId: "ent_contact",
  headerAxes: ["row"],
  segmentsByAxis: { row: [{ kind: "field", positionCount: 2 }] },
  headerStrategyByAxis: {
    row: {
      kind: "row",
      locator: { kind: "row", sheet: "Alpha", row: 1 },
      confidence: 0.95,
    },
  },
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
  ...overrides,
});

const basePlan = (overrides: Partial<LayoutPlan> = {}): LayoutPlan => ({
  planVersion: "1.0.0",
  workbookFingerprint: {
    sheetNames: ["Alpha"],
    dimensions: { Alpha: { rows: 3, cols: 2 } },
    anchorCells: [],
  },
  regions: [baseRegion()],
  confidence: { overall: 0.85, perRegion: { "region-1": 0.85 } },
  ...overrides,
});

const lockedStrategy = {
  kind: "rowPosition" as const,
  confidence: 1,
  source: "user" as const,
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("lockPlanIdentityToRowPosition", () => {
  it("locks kind: column identity to rowPosition", () => {
    const plan = basePlan({
      regions: [
        baseRegion({
          identityStrategy: {
            kind: "column",
            sourceLocator: { kind: "column", sheet: "Alpha", col: 1 },
            confidence: 0.85,
            source: "heuristic",
          },
        }),
      ],
    });

    const result = lockPlanIdentityToRowPosition(plan);

    expect(result.regions[0].identityStrategy).toEqual(lockedStrategy);
  });

  it("locks kind: composite identity to rowPosition", () => {
    const plan = basePlan({
      regions: [
        baseRegion({
          identityStrategy: {
            kind: "composite",
            sourceLocators: [
              { kind: "column", sheet: "Alpha", col: 1 },
              { kind: "column", sheet: "Alpha", col: 2 },
            ],
            joiner: "|",
            confidence: 0.7,
            source: "heuristic",
          },
        }),
      ],
    });

    const result = lockPlanIdentityToRowPosition(plan);

    expect(result.regions[0].identityStrategy).toEqual(lockedStrategy);
  });

  it("is idempotent on already-rowPosition input", () => {
    const plan = basePlan({
      regions: [
        baseRegion({
          identityStrategy: {
            kind: "rowPosition",
            confidence: 1,
            source: "user",
          },
        }),
      ],
    });

    const result = lockPlanIdentityToRowPosition(plan);

    expect(result.regions[0].identityStrategy).toEqual(lockedStrategy);
    // Pass through twice; output is structurally identical.
    const twice = lockPlanIdentityToRowPosition(result);
    expect(twice.regions[0].identityStrategy).toEqual(lockedStrategy);
  });

  it("strips ROW_POSITION_IDENTITY warnings", () => {
    const plan = basePlan({
      regions: [
        baseRegion({
          warnings: [
            {
              code: "ROW_POSITION_IDENTITY",
              severity: "warn",
              message: "Identity falls back to row position.",
            },
            {
              code: "MULTIPLE_HEADER_CANDIDATES",
              severity: "warn",
              message: "Multiple rows scored similarly as the header.",
            },
          ],
        }),
      ],
    });

    const result = lockPlanIdentityToRowPosition(plan);

    expect(result.regions[0].warnings).toEqual([
      {
        code: "MULTIPLE_HEADER_CANDIDATES",
        severity: "warn",
        message: "Multiple rows scored similarly as the header.",
      },
    ]);
  });

  it("preserves all other warning codes", () => {
    const warnings: Region["warnings"] = [
      {
        code: "MULTIPLE_HEADER_CANDIDATES",
        severity: "warn",
        message: "Multiple header candidates.",
      },
      {
        code: "MIXED_COLUMN_TYPES",
        severity: "info",
        message: "Mixed column types.",
      },
      {
        code: "DUPLICATE_IDENTITY_VALUES",
        severity: "blocker",
        message: "Duplicates in identity column.",
      },
    ];
    const plan = basePlan({
      regions: [baseRegion({ warnings })],
    });

    const result = lockPlanIdentityToRowPosition(plan);

    expect(result.regions[0].warnings).toEqual(warnings);
  });

  it("rewrites every region in a multi-region plan", () => {
    const plan = basePlan({
      regions: [
        baseRegion({
          id: "region-A",
          identityStrategy: {
            kind: "column",
            sourceLocator: { kind: "column", sheet: "Alpha", col: 1 },
            confidence: 0.8,
            source: "heuristic",
          },
          warnings: [
            {
              code: "ROW_POSITION_IDENTITY",
              severity: "warn",
              message: "advisory",
            },
          ],
        }),
        baseRegion({
          id: "region-B",
          identityStrategy: {
            kind: "composite",
            sourceLocators: [
              { kind: "column", sheet: "Alpha", col: 1 },
              { kind: "column", sheet: "Alpha", col: 2 },
            ],
            joiner: "::",
            confidence: 0.7,
            source: "heuristic",
          },
          warnings: [
            {
              code: "BOUNDS_OVERFLOW",
              severity: "warn",
              message: "bounds drifted",
            },
          ],
        }),
        baseRegion({
          id: "region-C",
          identityStrategy: { kind: "rowPosition", confidence: 0.5 },
          warnings: [
            {
              code: "ROW_POSITION_IDENTITY",
              severity: "warn",
              message: "advisory",
            },
            {
              code: "MIXED_COLUMN_TYPES",
              severity: "info",
              message: "mixed",
            },
          ],
        }),
      ],
    });

    const result = lockPlanIdentityToRowPosition(plan);

    expect(result.regions).toHaveLength(3);
    for (const region of result.regions) {
      expect(region.identityStrategy).toEqual(lockedStrategy);
      expect(
        region.warnings.some((w) => w.code === "ROW_POSITION_IDENTITY")
      ).toBe(false);
    }
    // Region B kept its non-rowPosition warning; Region C kept the
    // MIXED_COLUMN_TYPES one.
    expect(result.regions[1].warnings).toEqual([
      {
        code: "BOUNDS_OVERFLOW",
        severity: "warn",
        message: "bounds drifted",
      },
    ]);
    expect(result.regions[2].warnings).toEqual([
      {
        code: "MIXED_COLUMN_TYPES",
        severity: "info",
        message: "mixed",
      },
    ]);
  });

  it("returns a plan with zero regions when given zero regions", () => {
    // The schema technically requires regions.length >= 1, but the helper is
    // defensive and shouldn't throw on an empty array. Intermediate workflow
    // states (between an empty interpret and a re-interpret) can transit
    // empty plans through this helper.
    const plan = basePlan({ regions: [] });

    const result = lockPlanIdentityToRowPosition(plan);

    expect(result.regions).toEqual([]);
  });

  it("preserves non-identity, non-warning region fields", () => {
    const region = baseRegion({
      id: "region-pivot",
      sheet: "Beta",
      bounds: { startRow: 2, endRow: 7, startCol: 1, endCol: 6 },
      targetEntityDefinitionId: "ent_monthly_sales",
      headerAxes: ["row"],
      segmentsByAxis: {
        row: [
          {
            kind: "pivot",
            id: "monthly-sales-pivot",
            axisName: "month",
            axisNameSource: "user",
            positionCount: 6,
          },
        ],
      },
      cellValueField: { name: "sales", nameSource: "user" },
      columnBindings: [
        {
          sourceLocator: { kind: "byPositionIndex", axis: "row", index: 1 },
          columnDefinitionId: "cd_sales",
          confidence: 0.9,
        },
      ],
      identityStrategy: {
        kind: "column",
        sourceLocator: { kind: "column", sheet: "Beta", col: 1 },
        confidence: 0.6,
        source: "heuristic",
      },
      drift: {
        headerShiftRows: 2,
        addedColumns: "auto-apply",
        removedColumns: { max: 1, action: "auto-apply" },
      },
      confidence: { region: 0.78, aggregate: 0.74 },
    });
    const plan = basePlan({ regions: [region] });

    const result = lockPlanIdentityToRowPosition(plan);

    const out = result.regions[0];
    expect(out.id).toBe(region.id);
    expect(out.sheet).toBe(region.sheet);
    expect(out.bounds).toEqual(region.bounds);
    expect(out.targetEntityDefinitionId).toBe(region.targetEntityDefinitionId);
    expect(out.headerAxes).toEqual(region.headerAxes);
    expect(out.segmentsByAxis).toEqual(region.segmentsByAxis);
    expect(out.cellValueField).toEqual(region.cellValueField);
    expect(out.columnBindings).toEqual(region.columnBindings);
    expect(out.drift).toEqual(region.drift);
    expect(out.confidence).toEqual(region.confidence);
  });

  it("preserves planVersion and other top-level plan fields", () => {
    const plan = basePlan({
      planVersion: "2.4.7",
      workbookFingerprint: {
        sheetNames: ["Alpha", "Beta"],
        dimensions: {
          Alpha: { rows: 10, cols: 5 },
          Beta: { rows: 4, cols: 4 },
        },
        anchorCells: [{ sheet: "Alpha", row: 1, col: 1, value: "abc123" }],
      },
      confidence: {
        overall: 0.91,
        perRegion: { "region-1": 0.91 },
      },
    });

    const result = lockPlanIdentityToRowPosition(plan);

    expect(result.planVersion).toBe("2.4.7");
    expect(result.workbookFingerprint).toEqual(plan.workbookFingerprint);
    expect(result.confidence).toEqual(plan.confidence);
  });
});
