import { describe, it, expect } from "@jest/globals";

import type { InterpretInput } from "../../../plan/index.js";
import { createInitialState } from "../../state.js";
import { detectRegions } from "../detect-regions.js";
import { detectHeaders } from "../detect-headers.js";

function runWith(input: InterpretInput) {
  return detectHeaders(detectRegions(createInitialState(input)));
}

function simpleInput(): InterpretInput {
  return {
    workbook: {
      sheets: [
        {
          name: "Sheet1",
          dimensions: { rows: 3, cols: 3 },
          cells: [
            { row: 1, col: 1, value: "name" },
            { row: 1, col: 2, value: "age" },
            { row: 1, col: 3, value: "email" },
            { row: 2, col: 1, value: "alice" },
            { row: 2, col: 2, value: 30 },
            { row: 2, col: 3, value: "a@x.com" },
            { row: 3, col: 1, value: "bob" },
            { row: 3, col: 2, value: 25 },
            { row: 3, col: 3, value: "b@x.com" },
          ],
        },
      ],
    },
    regionHints: [
      {
        sheet: "Sheet1",
        bounds: { startRow: 1, startCol: 1, endRow: 3, endCol: 3 },
        targetEntityDefinitionId: "contacts",
        orientation: "rows-as-records",
        headerAxis: "row",
      },
    ],
  };
}

describe("detectHeaders", () => {
  it("picks the first row as the header candidate for a simple well-formed sheet", () => {
    const state = runWith(simpleInput());
    const regionId = state.detectedRegions[0].id;
    const candidates = state.headerCandidates.get(regionId);
    expect(candidates).toBeDefined();
    expect(candidates!.length).toBeGreaterThanOrEqual(1);
    const best = candidates![0];
    expect(best.axis).toBe("row");
    expect(best.index).toBe(1);
    expect(best.labels).toEqual(["name", "age", "email"]);
    expect(best.score).toBeGreaterThan(0);
  });

  it("skips leading title rows and picks the row with the highest header-ness score", () => {
    const input: InterpretInput = {
      workbook: {
        sheets: [
          {
            name: "Sheet1",
            dimensions: { rows: 4, cols: 3 },
            cells: [
              // Row 1: a single merged title — single non-empty cell, low score.
              { row: 1, col: 1, value: "My Spreadsheet" },
              // Row 2: three distinct, non-numeric labels — header-y.
              { row: 2, col: 1, value: "name" },
              { row: 2, col: 2, value: "age" },
              { row: 2, col: 3, value: "email" },
              // Rows 3–4: data with numbers mixed in.
              { row: 3, col: 1, value: "alice" },
              { row: 3, col: 2, value: 30 },
              { row: 3, col: 3, value: "a@x.com" },
              { row: 4, col: 1, value: "bob" },
              { row: 4, col: 2, value: 25 },
              { row: 4, col: 3, value: "b@x.com" },
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
    const state = runWith(input);
    const regionId = state.detectedRegions[0].id;
    const best = state.headerCandidates.get(regionId)![0];
    expect(best.index).toBe(2);
    expect(best.labels).toEqual(["name", "age", "email"]);
  });

  it("produces a column-axis candidate when headerAxis === 'column'", () => {
    const input: InterpretInput = {
      workbook: {
        sheets: [
          {
            name: "Sheet1",
            dimensions: { rows: 3, cols: 3 },
            cells: [
              // Column 1 is the label column; cols 2–3 are data.
              { row: 1, col: 1, value: "Name" },
              { row: 2, col: 1, value: "Age" },
              { row: 3, col: 1, value: "Email" },
              { row: 1, col: 2, value: "alice" },
              { row: 2, col: 2, value: 30 },
              { row: 3, col: 2, value: "a@x.com" },
              { row: 1, col: 3, value: "bob" },
              { row: 2, col: 3, value: 25 },
              { row: 3, col: 3, value: "b@x.com" },
            ],
          },
        ],
      },
      regionHints: [
        {
          sheet: "Sheet1",
          bounds: { startRow: 1, startCol: 1, endRow: 3, endCol: 3 },
          targetEntityDefinitionId: "contacts",
          orientation: "columns-as-records",
          headerAxis: "column",
        },
      ],
    };
    const state = runWith(input);
    const regionId = state.detectedRegions[0].id;
    const best = state.headerCandidates.get(regionId)![0];
    expect(best.axis).toBe("column");
    expect(best.index).toBe(1);
    expect(best.labels).toEqual(["Name", "Age", "Email"]);
  });

  it("skips header detection when headerAxis === 'none'", () => {
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
    const state = runWith(input);
    const regionId = state.detectedRegions[0].id;
    expect(state.headerCandidates.get(regionId)).toEqual([]);
  });

  it("is deterministic across repeated runs", () => {
    const first = runWith(simpleInput());
    const second = runWith(simpleInput());
    const id = first.detectedRegions[0].id;
    expect(first.headerCandidates.get(id)).toEqual(
      second.headerCandidates.get(id)
    );
  });
});
