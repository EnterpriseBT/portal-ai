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
  headerAxes: ["row"],
  segmentsByAxis: { row: [{ kind: "field", positionCount: 2 }] },
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

  it("passes user-confirmed cell-value field + anchor fields through (anchor converted 0→1-indexed)", () => {
    const hints = regionDraftsToHints(makeWorkbook(), [
      baseDraft({
        cellValueField: { name: "Revenue", nameSource: "user" },
        axisAnchorCell: { row: 2, col: 1 },
        proposedLabel: "Quarterly fact",
      }),
    ]);
    expect(hints[0]).toEqual(
      expect.objectContaining({
        cellValueField: { name: "Revenue", nameSource: "user" },
        axisAnchorCell: { row: 3, col: 2 },
        proposedLabel: "Quarterly fact",
      })
    );
  });

  it("forwards cellValueField verbatim regardless of nameSource", () => {
    const hints = regionDraftsToHints(makeWorkbook(), [
      baseDraft({
        cellValueField: { name: "metric", nameSource: "anchor-cell" },
        axisAnchorCell: { row: 0, col: 0 },
      }),
    ]);
    expect(hints[0].cellValueField).toEqual({
      name: "metric",
      nameSource: "anchor-cell",
    });
    expect(hints[0].axisAnchorCell).toEqual({ row: 1, col: 1 });
  });

  it("forwards AI-suggested cellValueField names", () => {
    const hints = regionDraftsToHints(makeWorkbook(), [
      baseDraft({
        cellValueField: { name: "Revenue", nameSource: "ai" },
      }),
    ]);
    expect(hints[0].cellValueField).toEqual({
      name: "Revenue",
      nameSource: "ai",
    });
  });

  it("forwards intersectionCellValueFields onto the hint so re-interpret keeps per-block names", () => {
    const hints = regionDraftsToHints(makeWorkbook(), [
      baseDraft({
        cellValueField: { name: "value", nameSource: "user" },
        intersectionCellValueFields: {
          rp1__cp1: { name: "Revenue", nameSource: "user" },
          rp1__cp2: {
            name: "Headcount",
            nameSource: "user",
            columnDefinitionId: "coldef_headcount",
          },
        },
      }),
    ]);
    expect(hints[0].intersectionCellValueFields).toEqual({
      rp1__cp1: { name: "Revenue", nameSource: "user" },
      rp1__cp2: {
        name: "Headcount",
        nameSource: "user",
        columnDefinitionId: "coldef_headcount",
      },
    });
  });

  it("forwards the draft's segmentsByAxis verbatim", () => {
    const hints = regionDraftsToHints(makeWorkbook(), [
      baseDraft({
        bounds: { startRow: 0, startCol: 0, endRow: 2, endCol: 3 },
        segmentsByAxis: { row: [{ kind: "field", positionCount: 4 }] },
      }),
    ]);
    expect(hints[0].headerAxes).toEqual(["row"]);
    expect(hints[0].segmentsByAxis).toEqual({
      row: [{ kind: "field", positionCount: 4 }],
    });
  });

  it("emits a headerless hint with recordsAxis when headerAxes is empty", () => {
    const hints = regionDraftsToHints(makeWorkbook(), [
      baseDraft({
        headerAxes: [],
        segmentsByAxis: undefined,
        recordsAxis: "row",
      }),
    ]);
    expect(hints[0].headerAxes).toEqual([]);
    expect(hints[0].recordsAxis).toBe("row");
    expect(hints[0].segmentsByAxis).toBeUndefined();
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

  it("emits hint.identityStrategy when the draft locks rowPosition with source: 'user'", () => {
    const hints = regionDraftsToHints(makeWorkbook(), [
      baseDraft({
        identityStrategy: {
          kind: "rowPosition",
          source: "user",
          confidence: 0,
        },
      }),
    ]);
    expect(hints[0].identityStrategy).toEqual({
      kind: "rowPosition",
      source: "user",
      confidence: 0,
    });
  });

  it("emits hint.identityStrategy when the draft locks a column locator with source: 'user'", () => {
    const hints = regionDraftsToHints(makeWorkbook(), [
      baseDraft({
        identityStrategy: {
          kind: "column",
          source: "user",
          confidence: 0.7,
          rawLocator: { kind: "column", sheet: "Alpha", col: 2 },
        },
      }),
    ]);
    expect(hints[0].identityStrategy).toEqual({
      kind: "column",
      source: "user",
      confidence: 0.7,
      sourceLocator: { kind: "column", sheet: "Alpha", col: 2 },
    });
  });

  it("omits hint.identityStrategy when the draft's source is 'heuristic' (so interpret re-detects)", () => {
    const hints = regionDraftsToHints(makeWorkbook(), [
      baseDraft({
        identityStrategy: {
          kind: "rowPosition",
          source: "heuristic",
          confidence: 0,
        },
      }),
    ]);
    expect(hints[0].identityStrategy).toBeUndefined();
  });

  it("omits hint.identityStrategy when the draft has no identityStrategy at all (back-compat)", () => {
    const hints = regionDraftsToHints(makeWorkbook(), [baseDraft()]);
    expect(hints[0].identityStrategy).toBeUndefined();
  });
});

describe("planRegionsToDrafts", () => {
  // Narrow plan-shaped fixture — `planRegionsToDrafts` only reads fields
  // enumerated in this fixture, so we skip the full LayoutPlan envelope.
  const plan = {
    regions: [
      {
        id: "region-1-Alpha-1x1",
        sheet: "Alpha",
        bounds: { startRow: 1, endRow: 3, startCol: 1, endCol: 2 },
        targetEntityDefinitionId: "ent_contact",
        headerAxes: ["row" as const],
        segmentsByAxis: {
          row: [{ kind: "field" as const, positionCount: 2 }],
        },
        headerStrategyByAxis: {
          row: {
            kind: "row" as const,
            locator: { kind: "row" as const, sheet: "Alpha", row: 1 },
            confidence: 0.95,
          },
        },
        identityStrategy: { kind: "rowPosition" as const, confidence: 0.9 },
        columnBindings: [
          {
            sourceLocator: {
              kind: "byHeaderName" as const,
              axis: "row" as const,
              name: "Name",
            },
            columnDefinitionId: "coldef_name",
            confidence: 0.95,
          },
          {
            sourceLocator: {
              kind: "byPositionIndex" as const,
              axis: "row" as const,
              index: 2,
            },
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
      perRegion: { "region-1-Alpha-1x1": 0.85 },
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

  it("preserves the plan region's id so drafts and plan.regions match by id", () => {
    const drafts = planRegionsToDrafts(plan, makeWorkbook());
    expect(drafts[0].id).toBe(plan.regions[0].id);
  });

  it("maps backend ColumnBinding locators into frontend string sourceLocators", () => {
    const drafts = planRegionsToDrafts(plan, makeWorkbook());
    const bindings = drafts[0].columnBindings ?? [];
    expect(bindings).toHaveLength(2);
    expect(bindings[0].sourceLocator).toBe("header:row:Name");
    expect(bindings[1].sourceLocator).toBe("pos:row:2");
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

  it("copies identityStrategy.source from the plan into the draft", () => {
    const planWithUserSource = {
      ...plan,
      regions: [
        {
          ...plan.regions[0],
          identityStrategy: {
            kind: "rowPosition" as const,
            confidence: 0,
            source: "user" as const,
          },
        },
      ],
    } as unknown as Parameters<typeof planRegionsToDrafts>[0];
    const drafts = planRegionsToDrafts(planWithUserSource, makeWorkbook());
    expect(drafts[0].identityStrategy?.source).toBe("user");
  });

  it("defaults identityStrategy.source to 'heuristic' on the draft when the plan omits it", () => {
    // The fixture's identityStrategy has no `source` key; the helper must
    // fill `"heuristic"` so the editor knows the choice was auto-detected.
    const drafts = planRegionsToDrafts(plan, makeWorkbook());
    expect(drafts[0].identityStrategy?.source).toBe("heuristic");
  });

  it("preserves the structured locator on the draft when the plan carries a column-locator strategy", () => {
    const planWithLocator = {
      ...plan,
      regions: [
        {
          ...plan.regions[0],
          identityStrategy: {
            kind: "column" as const,
            sourceLocator: {
              kind: "column" as const,
              sheet: "Alpha",
              col: 1,
            },
            confidence: 0.7,
            source: "user" as const,
          },
        },
      ],
    } as unknown as Parameters<typeof planRegionsToDrafts>[0];
    const drafts = planRegionsToDrafts(planWithLocator, makeWorkbook());
    expect(drafts[0].identityStrategy).toEqual(
      expect.objectContaining({
        kind: "column",
        source: "user",
        confidence: 0.7,
        rawLocator: { kind: "column", sheet: "Alpha", col: 1 },
      })
    );
  });
});

describe("preserveUserRegionConfig", () => {
  const baseRegion: LayoutPlan["regions"][number] = {
    id: "region-1",
    sheet: "Alpha",
    bounds: { startRow: 1, endRow: 3, startCol: 1, endCol: 2 },
    targetEntityDefinitionId: "ent_contact",
    headerAxes: ["row"],
    segmentsByAxis: {
      row: [{ kind: "field", positionCount: 2 }],
    },
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

  it("copies columnOverrides from the prior draft onto the plan", () => {
    const result = preserveUserRegionConfig(basePlan, [
      baseDraft({ columnOverrides: { columnA: "customerName" } }),
    ]);
    expect(result.regions[0].columnOverrides).toEqual({
      columnA: "customerName",
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
      baseDraft({ columnOverrides: { a: "first" } }),
      baseDraft({ columnOverrides: { b: "second" } }),
    ]);
    expect(result.regions[0].columnOverrides).toEqual({ a: "first" });
    expect(result.regions[1].columnOverrides).toEqual({ b: "second" });
  });

  it("returns the plan unchanged when no drafts have a target entity", () => {
    const result = preserveUserRegionConfig(basePlan, [
      baseDraft({ targetEntityDefinitionId: null }),
    ]);
    expect(result).toBe(basePlan);
  });

  describe("— pivot binding adoption", () => {
    // Re-interpret carries the latest classifier output for pivot/cellValueField
    // on the response. The user's prior draft holds its own segment edits but
    // a (stale) columnDefinitionId — preserveUserRegionConfig must keep the
    // user's name/positionCount knobs and adopt the response's freshly-
    // classified columnDefinitionId so the review chip never falls back to
    // "Unbound" after a re-interpret.
    const pivotPlanRegion: LayoutPlan["regions"][number] = {
      ...baseRegion,
      bounds: { startRow: 1, endRow: 3, startCol: 1, endCol: 4 },
      segmentsByAxis: {
        row: [
          { kind: "field", positionCount: 1 },
          {
            kind: "pivot",
            id: "pivot-1",
            axisName: "timestamp",
            axisNameSource: "user",
            positionCount: 3,
            columnDefinitionId: "coldef_timestamp_fresh",
          },
        ],
      },
      cellValueField: {
        name: "amount",
        nameSource: "user",
        columnDefinitionId: "coldef_amount_fresh",
      },
    };
    const pivotPlan: LayoutPlan = {
      ...basePlan,
      regions: [pivotPlanRegion],
    };

    it("adopts the response's pivot columnDefinitionId, keeping the prior axisName/positionCount", () => {
      const result = preserveUserRegionConfig(pivotPlan, [
        baseDraft({
          bounds: { startRow: 0, endRow: 2, startCol: 0, endCol: 3 },
          segmentsByAxis: {
            row: [
              { kind: "field", positionCount: 1 },
              {
                kind: "pivot",
                id: "pivot-1",
                axisName: "timestamp",
                axisNameSource: "user",
                positionCount: 3,
                // Prior draft's stale binding — must NOT clobber the response.
                columnDefinitionId: "coldef_stale",
              },
            ],
          },
          cellValueField: {
            name: "amount",
            nameSource: "user",
            columnDefinitionId: "coldef_amount_stale",
          },
        }),
      ]);
      const pivot = result.regions[0].segmentsByAxis?.row?.find(
        (s) => s.kind === "pivot"
      );
      expect(pivot?.kind).toBe("pivot");
      if (pivot?.kind === "pivot") {
        expect(pivot.axisName).toBe("timestamp");
        expect(pivot.axisNameSource).toBe("user");
        expect(pivot.columnDefinitionId).toBe("coldef_timestamp_fresh");
      }
      expect(result.regions[0].cellValueField).toMatchObject({
        name: "amount",
        nameSource: "user",
        columnDefinitionId: "coldef_amount_fresh",
      });
    });

    it("leaves the prior pivot columnDefinitionId intact when the response didn't classify one", () => {
      // Response has the pivot segment but no columnDefinitionId (e.g. no
      // text-fallback wired). The user's prior draft must still win in that
      // case — re-interpret can't be allowed to drop a previously-bound
      // pivot to undefined.
      const responseMinusBinding: LayoutPlan = {
        ...pivotPlan,
        regions: [
          {
            ...pivotPlanRegion,
            segmentsByAxis: {
              row: [
                { kind: "field", positionCount: 1 },
                {
                  kind: "pivot",
                  id: "pivot-1",
                  axisName: "timestamp",
                  axisNameSource: "user",
                  positionCount: 3,
                },
              ],
            },
            cellValueField: { name: "amount", nameSource: "user" },
          },
        ],
      };
      const result = preserveUserRegionConfig(responseMinusBinding, [
        baseDraft({
          bounds: { startRow: 0, endRow: 2, startCol: 0, endCol: 3 },
          segmentsByAxis: {
            row: [
              { kind: "field", positionCount: 1 },
              {
                kind: "pivot",
                id: "pivot-1",
                axisName: "timestamp",
                axisNameSource: "user",
                positionCount: 3,
                columnDefinitionId: "coldef_user_pinned",
              },
            ],
          },
          cellValueField: {
            name: "amount",
            nameSource: "user",
            columnDefinitionId: "coldef_user_pinned_amount",
          },
        }),
      ]);
      const pivot = result.regions[0].segmentsByAxis?.row?.find(
        (s) => s.kind === "pivot"
      );
      if (pivot?.kind === "pivot") {
        expect(pivot.columnDefinitionId).toBe("coldef_user_pinned");
      }
      expect(
        result.regions[0].cellValueField?.columnDefinitionId
      ).toBe("coldef_user_pinned_amount");
    });
  });

  describe("— binding overrides", () => {
    const baseBackendBinding: LayoutPlan["regions"][number]["columnBindings"][number] =
      {
        sourceLocator: { kind: "byHeaderName", axis: "row", name: "Email" },
        columnDefinitionId: "coldef_email",
        confidence: 0.9,
      };
    const regionWithBindings: LayoutPlan["regions"][number] = {
      ...baseRegion,
      columnBindings: [
        baseBackendBinding,
        {
          sourceLocator: { kind: "byPositionIndex", axis: "row", index: 2 },
          columnDefinitionId: "coldef_name",
          confidence: 0.7,
        },
      ],
    };
    const planWithBindings: LayoutPlan = {
      ...basePlan,
      regions: [regionWithBindings],
    };

    it("carries binding-level overrides from prior drafts onto the plan, matching by serialized sourceLocator", () => {
      const result = preserveUserRegionConfig(planWithBindings, [
        baseDraft({
          columnBindings: [
            {
              sourceLocator: "header:row:Email",
              columnDefinitionId: "coldef_email",
              confidence: 0.9,
              excluded: false,
              normalizedKey: "email_override",
              required: true,
              defaultValue: "unknown@example.com",
              format: "lowercase",
              enumValues: null,
              refEntityKey: null,
              refNormalizedKey: null,
            },
            {
              sourceLocator: "pos:row:2",
              columnDefinitionId: "coldef_name",
              confidence: 0.7,
              excluded: true,
            },
          ],
        }),
      ]);
      const bindings = result.regions[0].columnBindings;
      expect(bindings[0]).toMatchObject({
        sourceLocator: { kind: "byHeaderName", axis: "row", name: "Email" },
        columnDefinitionId: "coldef_email",
        normalizedKey: "email_override",
        required: true,
        defaultValue: "unknown@example.com",
        format: "lowercase",
      });
      expect(bindings[1].excluded).toBe(true);
    });

    it("prefers the user's columnDefinitionId override when prior draft differs from plan", () => {
      const result = preserveUserRegionConfig(planWithBindings, [
        baseDraft({
          columnBindings: [
            {
              sourceLocator: "header:row:Email",
              columnDefinitionId: "coldef_email_rebind",
              confidence: 1,
            },
          ],
        }),
      ]);
      expect(result.regions[0].columnBindings[0].columnDefinitionId).toBe(
        "coldef_email_rebind"
      );
    });

    it("leaves non-overridden fields as interpret returned them", () => {
      const result = preserveUserRegionConfig(planWithBindings, [
        baseDraft({
          columnBindings: [
            {
              sourceLocator: "header:row:Email",
              columnDefinitionId: "coldef_email",
              confidence: 0.9,
              // no override fields set
            },
          ],
        }),
      ]);
      expect(result.regions[0].columnBindings[0]).toEqual(baseBackendBinding);
    });

    it("drops prior overrides when the plan no longer carries a matching binding", () => {
      const result = preserveUserRegionConfig(planWithBindings, [
        baseDraft({
          columnBindings: [
            {
              sourceLocator: "header:row:PhantomColumn",
              columnDefinitionId: "coldef_ghost",
              confidence: 1,
              excluded: true,
            },
          ],
        }),
      ]);
      const bindings = result.regions[0].columnBindings;
      expect(bindings).toHaveLength(2);
      expect(
        bindings.some((b) => "excluded" in b && b.excluded === true)
      ).toBe(false);
    });

    it("skips binding merge when the prior draft has no columnBindings", () => {
      const result = preserveUserRegionConfig(planWithBindings, [
        baseDraft({ columnBindings: undefined }),
      ]);
      expect(result.regions[0].columnBindings).toEqual(
        regionWithBindings.columnBindings
      );
    });
  });
});

describe("planRegionsToDrafts — binding overrides", () => {
  it("copies excluded / normalizedKey / required / defaultValue / format / enumValues / refEntityKey / refNormalizedKey from each binding onto the resulting draft", () => {
    const plan = {
      regions: [
        {
          id: "region-1",
          sheet: "Alpha",
          bounds: { startRow: 1, endRow: 3, startCol: 1, endCol: 2 },
          targetEntityDefinitionId: "ent_contact",
          headerAxes: ["row" as const],
          segmentsByAxis: {
            row: [{ kind: "field" as const, positionCount: 2 }],
          },
          headerStrategyByAxis: {
            row: {
              kind: "row" as const,
              locator: { kind: "row" as const, sheet: "Alpha", row: 1 },
              confidence: 0.95,
            },
          },
          identityStrategy: { kind: "rowPosition" as const, confidence: 0.9 },
          columnBindings: [
            {
              sourceLocator: {
                kind: "byHeaderName" as const,
                axis: "row" as const,
                name: "Email",
              },
              columnDefinitionId: "coldef_email",
              confidence: 0.9,
              excluded: true,
              normalizedKey: "email_override",
              required: true,
              defaultValue: "foo",
              format: "lowercase",
              enumValues: ["A", "B"],
              refEntityKey: "customers",
              refNormalizedKey: "id",
            },
          ],
          skipRules: [],
          drift: { boundsPolicy: "auto" as const },
          confidence: { region: 0.9, aggregate: 0.85 },
          warnings: [],
        },
      ],
      confidence: { overall: 0.85, perRegion: { "region-1": 0.85 } },
    } as unknown as Parameters<typeof planRegionsToDrafts>[0];
    const drafts = planRegionsToDrafts(plan, makeWorkbook());
    const binding = drafts[0].columnBindings?.[0];
    expect(binding).toMatchObject({
      sourceLocator: "header:row:Email",
      columnDefinitionId: "coldef_email",
      excluded: true,
      normalizedKey: "email_override",
      required: true,
      defaultValue: "foo",
      format: "lowercase",
      enumValues: ["A", "B"],
      refEntityKey: "customers",
      refNormalizedKey: "id",
    });
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
