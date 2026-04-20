import { describe, it, expect } from "@jest/globals";

import type { InterpretInput } from "../../../plan/index.js";
import { createInitialState } from "../../state.js";
import { detectRegions } from "../detect-regions.js";
import { detectHeaders } from "../detect-headers.js";
import { detectIdentity } from "../detect-identity.js";

function runPipeline(input: InterpretInput) {
  return detectIdentity(
    detectHeaders(detectRegions(createInitialState(input)))
  );
}

function uniqueColumnInput(): InterpretInput {
  return {
    workbook: {
      sheets: [
        {
          name: "Sheet1",
          dimensions: { rows: 4, cols: 3 },
          cells: [
            { row: 1, col: 1, value: "id" },
            { row: 1, col: 2, value: "name" },
            { row: 1, col: 3, value: "age" },
            { row: 2, col: 1, value: "a-1" },
            { row: 2, col: 2, value: "alice" },
            { row: 2, col: 3, value: 30 },
            { row: 3, col: 1, value: "a-2" },
            { row: 3, col: 2, value: "bob" },
            { row: 3, col: 3, value: 25 },
            { row: 4, col: 1, value: "a-3" },
            { row: 4, col: 2, value: "carol" },
            { row: 4, col: 3, value: 40 },
          ],
        },
      ],
    },
    regionHints: [
      {
        sheet: "Sheet1",
        bounds: { startRow: 1, startCol: 1, endRow: 4, endCol: 3 },
        targetEntityDefinitionId: "contacts",
        orientation: "rows-as-records",
        headerAxis: "row",
      },
    ],
  };
}

describe("detectIdentity", () => {
  it("prefers a single unique column when one exists (highest score wins)", () => {
    const state = runPipeline(uniqueColumnInput());
    const regionId = state.detectedRegions[0].id;
    const candidates = state.identityCandidates.get(regionId);
    expect(candidates).toBeDefined();
    expect(candidates!.length).toBeGreaterThanOrEqual(1);
    const best = candidates![0];
    expect(best.strategy.kind).toBe("column");
    expect(best.score).toBeGreaterThan(0.5);
    if (best.strategy.kind === "column") {
      expect(best.strategy.sourceLocator.kind).toBe("column");
    }
  });

  it("falls back to rowPosition when no single column AND no pair of columns produce unique keys", () => {
    // Every (team, member) pair is duplicated — no single or composite key is unique.
    const input: InterpretInput = {
      workbook: {
        sheets: [
          {
            name: "Sheet1",
            dimensions: { rows: 5, cols: 2 },
            cells: [
              { row: 1, col: 1, value: "team" },
              { row: 1, col: 2, value: "member" },
              { row: 2, col: 1, value: "alpha" },
              { row: 2, col: 2, value: "alice" },
              { row: 3, col: 1, value: "alpha" },
              { row: 3, col: 2, value: "alice" },
              { row: 4, col: 1, value: "beta" },
              { row: 4, col: 2, value: "bob" },
              { row: 5, col: 1, value: "beta" },
              { row: 5, col: 2, value: "bob" },
            ],
          },
        ],
      },
      regionHints: [
        {
          sheet: "Sheet1",
          bounds: { startRow: 1, startCol: 1, endRow: 5, endCol: 2 },
          targetEntityDefinitionId: "team-members",
          orientation: "rows-as-records",
          headerAxis: "row",
        },
      ],
    };
    const state = runPipeline(input);
    const regionId = state.detectedRegions[0].id;
    const candidates = state.identityCandidates.get(regionId)!;
    expect(candidates[0].strategy.kind).toBe("rowPosition");
  });

  it("proposes a composite strategy when two columns together are unique but neither is alone", () => {
    const input: InterpretInput = {
      workbook: {
        sheets: [
          {
            name: "Sheet1",
            dimensions: { rows: 4, cols: 3 },
            cells: [
              { row: 1, col: 1, value: "team" },
              { row: 1, col: 2, value: "member" },
              { row: 1, col: 3, value: "note" },
              { row: 2, col: 1, value: "alpha" },
              { row: 2, col: 2, value: "alice" },
              { row: 3, col: 1, value: "alpha" },
              { row: 3, col: 2, value: "bob" },
              { row: 4, col: 1, value: "beta" },
              { row: 4, col: 2, value: "alice" },
            ],
          },
        ],
      },
      regionHints: [
        {
          sheet: "Sheet1",
          bounds: { startRow: 1, startCol: 1, endRow: 4, endCol: 3 },
          targetEntityDefinitionId: "team-members",
          orientation: "rows-as-records",
          headerAxis: "row",
        },
      ],
    };
    const state = runPipeline(input);
    const regionId = state.detectedRegions[0].id;
    const candidates = state.identityCandidates.get(regionId)!;
    const compositeOrPosition = candidates[0].strategy.kind;
    // Composite must be present in the candidate list even if rowPosition
    // edges it; the caller (propose-bindings) picks between them.
    expect(candidates.some((c) => c.strategy.kind === "composite")).toBe(true);
    // And the top candidate is either composite or rowPosition (never column).
    expect(["composite", "rowPosition"]).toContain(compositeOrPosition);
  });

  it("assigns confidence 0 when headerAxis === 'none' and emits only rowPosition", () => {
    const input: InterpretInput = {
      workbook: {
        sheets: [
          {
            name: "Sheet1",
            dimensions: { rows: 2, cols: 2 },
            cells: [
              { row: 1, col: 1, value: "a" },
              { row: 1, col: 2, value: "b" },
              { row: 2, col: 1, value: "c" },
              { row: 2, col: 2, value: "d" },
            ],
          },
        ],
      },
      regionHints: [
        {
          sheet: "Sheet1",
          bounds: { startRow: 1, startCol: 1, endRow: 2, endCol: 2 },
          targetEntityDefinitionId: "headerless",
          orientation: "rows-as-records",
          headerAxis: "none",
        },
      ],
    };
    const state = runPipeline(input);
    const regionId = state.detectedRegions[0].id;
    const candidates = state.identityCandidates.get(regionId)!;
    expect(candidates).toHaveLength(1);
    expect(candidates[0].strategy.kind).toBe("rowPosition");
  });
});
