import { describe, it, expect } from "@jest/globals";

import { reconcileCellValueFields } from "../cell-value-fields.util.js";
import type { CellValueFieldShape } from "../cell-value-fields.util.js";

const field = (name: string) => ({ name, nameSource: "user" as const });

describe("reconcileCellValueFields (#998)", () => {
  it("drops cell-value fields when there's no pivot", () => {
    const out = reconcileCellValueFields({
      segmentsByAxis: { row: [{ kind: "field" }] },
      cellValueField: field("value"),
      intersectionCellValueFields: { a__b: field("x") },
    });
    expect(out).not.toHaveProperty("cellValueField");
    expect(out).not.toHaveProperty("intersectionCellValueFields");
  });

  it("fills a pivot's missing cellValueField only when given a default", () => {
    const pivoted: CellValueFieldShape = {
      segmentsByAxis: { row: [{ kind: "pivot", id: "p" }] },
    };
    expect(reconcileCellValueFields(pivoted)).not.toHaveProperty(
      "cellValueField"
    );
    expect(
      reconcileCellValueFields(pivoted, { defaultField: field("value") })
        .cellValueField
    ).toEqual(field("value"));
  });

  it("keeps an existing cellValueField over the default", () => {
    const out = reconcileCellValueFields(
      {
        segmentsByAxis: { row: [{ kind: "pivot", id: "p" }] },
        cellValueField: field("amount"),
      },
      { defaultField: field("value") }
    );
    expect(out.cellValueField).toEqual(field("amount"));
  });

  it("keeps only intersection entries naming a row and a column pivot", () => {
    const out = reconcileCellValueFields({
      headerAxes: ["row", "column"],
      segmentsByAxis: {
        row: [{ kind: "pivot", id: "r1" }],
        column: [{ kind: "pivot", id: "c1" }],
      },
      cellValueField: field("value"),
      intersectionCellValueFields: {
        r1__c1: field("kept"),
        r1__gone: field("x"),
        nosep: field("y"),
      },
    });
    expect(Object.keys(out.intersectionCellValueFields ?? {})).toEqual([
      "r1__c1",
    ]);
  });

  it("drops intersection fields on a region without two header axes", () => {
    const out = reconcileCellValueFields({
      headerAxes: ["row"],
      segmentsByAxis: {
        row: [{ kind: "pivot", id: "r1" }],
        column: [{ kind: "pivot", id: "c1" }],
      },
      cellValueField: field("value"),
      intersectionCellValueFields: { r1__c1: field("x") },
    });
    expect(out).not.toHaveProperty("intersectionCellValueFields");
  });
});
