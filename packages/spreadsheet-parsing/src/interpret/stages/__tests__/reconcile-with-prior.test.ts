import { describe, it, expect } from "@jest/globals";

import type { InterpretInput, LayoutPlan } from "../../../plan/index.js";
import { createInitialState } from "../../state.js";
import { detectRegions } from "../detect-regions.js";
import { detectHeaders } from "../detect-headers.js";
import { detectIdentity } from "../detect-identity.js";
import { classifyColumns } from "../classify-columns.js";
import { recommendRecordsAxisName } from "../recommend-records-axis-name.js";
import { proposeBindings } from "../propose-bindings.js";
import { reconcileWithPrior } from "../reconcile-with-prior.js";

async function buildAssembledState(input: InterpretInput) {
  let state = detectRegions(createInitialState(input));
  state = detectHeaders(state);
  state = detectIdentity(state);
  state = await classifyColumns(state, {});
  state = await recommendRecordsAxisName(state, {});
  state = proposeBindings(state);
  return state;
}

function input(): InterpretInput {
  return {
    workbook: {
      sheets: [
        {
          name: "Sheet1",
          dimensions: { rows: 3, cols: 2 },
          cells: [
            { row: 1, col: 1, value: "id" },
            { row: 1, col: 2, value: "name" },
            { row: 2, col: 1, value: "a-1" },
            { row: 2, col: 2, value: "alice" },
            { row: 3, col: 1, value: "a-2" },
            { row: 3, col: 2, value: "bob" },
          ],
        },
      ],
    },
    regionHints: [
      {
        sheet: "Sheet1",
        bounds: { startRow: 1, startCol: 1, endRow: 3, endCol: 2 },
        targetEntityDefinitionId: "contacts",
        orientation: "rows-as-records",
        headerAxis: "row",
      },
    ],
  };
}

function priorPlanFromState(
  state: Awaited<ReturnType<typeof buildAssembledState>>
): LayoutPlan {
  return {
    planVersion: "1.0.0",
    workbookFingerprint: {
      sheetNames: ["Sheet1"],
      dimensions: { Sheet1: { rows: 3, cols: 2 } },
      anchorCells: [{ sheet: "Sheet1", row: 1, col: 1, value: "id" }],
    },
    regions: state.detectedRegions.map((r) => ({
      ...r,
      // Override the id so we can assert id preservation by fingerprint match.
      id: "prior-region-id-42",
    })),
    confidence: {
      overall: 0.9,
      perRegion: { "prior-region-id-42": 0.9 },
    },
  };
}

describe("reconcileWithPrior", () => {
  it("is a no-op when no priorPlan is provided", async () => {
    const state = await buildAssembledState(input());
    const next = reconcileWithPrior(state);
    expect(next.reconcileDiff).toBeUndefined();
    expect(next.detectedRegions[0].id).toBe(state.detectedRegions[0].id);
  });

  it("preserves prior region ids when the fingerprint (sheet + targetEntityDefinitionId + bounds) matches", async () => {
    let state = await buildAssembledState(input());
    const prior = priorPlanFromState(state);
    state = { ...state, input: { ...state.input, priorPlan: prior } };
    const next = reconcileWithPrior(state);
    expect(next.detectedRegions[0].id).toBe("prior-region-id-42");
    expect(next.reconcileDiff?.preserved).toEqual(["prior-region-id-42"]);
    expect(next.reconcileDiff?.added).toEqual([]);
    expect(next.reconcileDiff?.removed).toEqual([]);
  });

  it("lists added regions in reconcileDiff.added when a region has no fingerprint match in the prior plan", async () => {
    let state = await buildAssembledState(input());
    const prior: LayoutPlan = {
      planVersion: "1.0.0",
      workbookFingerprint: {
        sheetNames: ["Sheet1"],
        dimensions: { Sheet1: { rows: 3, cols: 2 } },
        anchorCells: [],
      },
      regions: [],
      confidence: { overall: 1, perRegion: {} },
    };
    state = { ...state, input: { ...state.input, priorPlan: prior } };
    const next = reconcileWithPrior(state);
    expect(next.reconcileDiff?.added).toEqual([state.detectedRegions[0].id]);
    expect(next.reconcileDiff?.preserved).toEqual([]);
  });

  it("lists removed regions (prior regions absent from the new plan)", async () => {
    let state = await buildAssembledState(input());
    const prior: LayoutPlan = {
      planVersion: "1.0.0",
      workbookFingerprint: {
        sheetNames: ["Sheet1"],
        dimensions: { Sheet1: { rows: 3, cols: 2 } },
        anchorCells: [],
      },
      regions: [
        {
          ...state.detectedRegions[0],
          id: "ghost-region",
          targetEntityDefinitionId: "ghost-entity",
        },
      ],
      confidence: { overall: 1, perRegion: { "ghost-region": 1 } },
    };
    state = { ...state, input: { ...state.input, priorPlan: prior } };
    const next = reconcileWithPrior(state);
    expect(next.reconcileDiff?.removed).toEqual(["ghost-region"]);
  });

  it("flags identityChanged when a preserved region's identity strategy differs from the prior", async () => {
    let state = await buildAssembledState(input());
    const prior = priorPlanFromState(state);
    // Mutate the prior's identity strategy so it no longer matches.
    prior.regions[0] = {
      ...prior.regions[0],
      identityStrategy: { kind: "rowPosition", confidence: 0.5 },
    };
    state = { ...state, input: { ...state.input, priorPlan: prior } };
    const next = reconcileWithPrior(state);
    expect(next.reconcileDiff?.identityChanged).toEqual(["prior-region-id-42"]);
  });
});
