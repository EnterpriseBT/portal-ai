import { describe, it, expect } from "@jest/globals";

import type { LayoutPlan } from "../../plan/index.js";
import type { WorkbookData } from "../../workbook/index.js";
import { replay } from "../index.js";

function contactsPlan(): LayoutPlan {
  return {
    planVersion: "1.0.0",
    workbookFingerprint: {
      sheetNames: ["Contacts"],
      dimensions: { Contacts: { rows: 4, cols: 3 } },
      anchorCells: [{ sheet: "Contacts", row: 1, col: 1, value: "email" }],
    },
    regions: [
      {
        id: "r1",
        sheet: "Contacts",
        bounds: { startRow: 1, startCol: 1, endRow: 4, endCol: 3 },
        boundsMode: "absolute",
        targetEntityDefinitionId: "contacts",
        orientation: "rows-as-records",
        headerAxis: "row",
        headerStrategy: {
          kind: "row",
          locator: { kind: "row", sheet: "Contacts", row: 1 },
          confidence: 0.95,
        },
        identityStrategy: {
          kind: "column",
          sourceLocator: { kind: "column", sheet: "Contacts", col: 1 },
          confidence: 0.9,
        },
        columnBindings: [
          {
            sourceLocator: { kind: "byHeaderName", name: "email" },
            columnDefinitionId: "col-email",
            confidence: 0.9,
          },
          {
            sourceLocator: { kind: "byHeaderName", name: "name" },
            columnDefinitionId: "col-name",
            confidence: 0.9,
          },
          {
            sourceLocator: { kind: "byHeaderName", name: "age" },
            columnDefinitionId: "col-age",
            confidence: 0.9,
          },
        ],
        skipRules: [],
        drift: {
          headerShiftRows: 0,
          addedColumns: "halt",
          removedColumns: { max: 0, action: "halt" },
        },
        confidence: { region: 0.9, aggregate: 0.9 },
        warnings: [],
      },
    ],
    confidence: { overall: 0.9, perRegion: { r1: 0.9 } },
  };
}

const contactsWorkbookData: WorkbookData = {
  sheets: [
    {
      name: "Contacts",
      dimensions: { rows: 4, cols: 3 },
      cells: [
        { row: 1, col: 1, value: "email" },
        { row: 1, col: 2, value: "name" },
        { row: 1, col: 3, value: "age" },
        { row: 2, col: 1, value: "a@x.com" },
        { row: 2, col: 2, value: "alice" },
        { row: 2, col: 3, value: 30 },
        { row: 3, col: 1, value: "b@x.com" },
        { row: 3, col: 2, value: "bob" },
        { row: 3, col: 3, value: 25 },
        { row: 4, col: 1, value: "c@x.com" },
        { row: 4, col: 2, value: "carol" },
        { row: 4, col: 3, value: 40 },
      ],
    },
  ],
};

describe("replay() — orchestration", () => {
  it("returns records + drift from a full plan against a WorkbookData", () => {
    const result = replay(contactsPlan(), contactsWorkbookData);
    expect(result.records).toHaveLength(3);
    expect(result.drift.regionDrifts).toHaveLength(1);
    expect(result.drift.severity).toBe("none");
    expect(result.drift.identityChanging).toBe(false);
  });

  it("is deterministic — second call returns an identical result", () => {
    const a = replay(contactsPlan(), contactsWorkbookData);
    const b = replay(contactsPlan(), contactsWorkbookData);
    expect(a).toEqual(b);
  });

  it("emits records in plan-region order across multiple regions", () => {
    const plan = contactsPlan();
    plan.regions.push({ ...plan.regions[0], id: "r2" });
    plan.confidence.perRegion["r2"] = 0.9;
    const result = replay(plan, contactsWorkbookData);
    expect(result.records).toHaveLength(6);
    expect(result.records.slice(0, 3).every((r) => r.regionId === "r1")).toBe(
      true
    );
    expect(result.records.slice(3, 6).every((r) => r.regionId === "r2")).toBe(
      true
    );
  });

  it("skips regions whose sheet is missing from the workbook without throwing", () => {
    const plan = contactsPlan();
    plan.regions.push({
      ...plan.regions[0],
      id: "ghost",
      sheet: "DoesNotExist",
    });
    plan.confidence.perRegion["ghost"] = 0;
    const result = replay(plan, contactsWorkbookData);
    // r1 emits 3 records; ghost contributes none.
    expect(result.records).toHaveLength(3);
  });

  it("rejects malformed plans via LayoutPlanSchema.parse()", () => {
    const plan = contactsPlan() as unknown as Record<string, unknown>;
    delete plan.planVersion;
    expect(() =>
      replay(plan as unknown as LayoutPlan, contactsWorkbookData)
    ).toThrow();
  });
});
