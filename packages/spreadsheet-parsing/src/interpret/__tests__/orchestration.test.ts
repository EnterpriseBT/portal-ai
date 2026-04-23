import { describe, it, expect } from "@jest/globals";

import type { InterpretInput } from "../../plan/index.js";
import { LayoutPlanSchema } from "../../plan/index.js";
import { makeSheetAccessor } from "../../workbook/helpers.js";
import { extractRecords } from "../../replay/extract-records.js";
import { interpret } from "../index.js";

function cloneInput(input: InterpretInput): InterpretInput {
  return JSON.parse(JSON.stringify(input)) as InterpretInput;
}

function contactsInput(): InterpretInput {
  return {
    workbook: {
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
    },
    regionHints: [
      {
        sheet: "Contacts",
        bounds: { startRow: 1, startCol: 1, endRow: 4, endCol: 3 },
        targetEntityDefinitionId: "contacts",
        headerAxes: ["row"],
      },
    ],
  };
}

describe("interpret() — orchestration", () => {
  it("runs every stage in order and returns a plan that satisfies LayoutPlanSchema", async () => {
    const plan = await interpret(contactsInput(), {
      columnDefinitionCatalog: [
        { id: "col-email", label: "Email", normalizedKey: "email" },
        { id: "col-name", label: "Name", normalizedKey: "name" },
      ],
    });
    const result = LayoutPlanSchema.safeParse(plan);
    if (!result.success) {
      throw new Error(JSON.stringify(result.error.issues, null, 2));
    }
    expect(result.success).toBe(true);
    expect(plan.regions).toHaveLength(1);
    expect(plan.regions[0].columnBindings.length).toBeGreaterThan(0);
  });

  it("is deterministic — second call against a cloned input produces an equal plan (default deps)", async () => {
    const a = await interpret(contactsInput());
    const b = await interpret(cloneInput(contactsInput()));
    expect(a).toEqual(b);
  });

  it("propagates injected classifier through to column bindings", async () => {
    const plan = await interpret(contactsInput(), {
      classifier: async (candidates) =>
        candidates.map((c) => ({
          sourceHeader: c.sourceHeader,
          sourceCol: c.sourceCol,
          columnDefinitionId: `override-${c.sourceHeader}`,
          confidence: 0.99,
          rationale: "injected",
        })),
      columnDefinitionCatalog: [{ id: "x", label: "x" }],
    });
    const ids = plan.regions[0].columnBindings.map((b) => b.columnDefinitionId);
    expect(ids.every((id) => id?.startsWith("override-"))).toBe(true);
  });

  it("feeds contacts plan through extractRecords — 3 records with expected column-def fields", async () => {
    const input = contactsInput();
    const plan = await interpret(input, {
      columnDefinitionCatalog: [
        { id: "col-email", label: "Email", normalizedKey: "email" },
        { id: "col-name", label: "Name", normalizedKey: "name" },
        { id: "col-age", label: "Age", normalizedKey: "age" },
      ],
    });
    const sheet = makeSheetAccessor(input.workbook.sheets[0]);
    const records = extractRecords(plan.regions[0], sheet);
    expect(records).toHaveLength(3);
    expect(records.every((r) => r.targetEntityDefinitionId === "contacts")).toBe(
      true
    );
    expect(records.every((r) => r.regionId === plan.regions[0].id)).toBe(true);
    expect(records.map((r) => r.fields["col-email"])).toEqual([
      "a@x.com",
      "b@x.com",
      "c@x.com",
    ]);
    expect(records.map((r) => r.fields["col-name"])).toEqual([
      "alice",
      "bob",
      "carol",
    ]);
    expect(records.map((r) => r.fields["col-age"])).toEqual([30, 25, 40]);
  });

  it("injected classifier round-trips through extractRecords — overrides appear as field keys", async () => {
    const input = contactsInput();
    const plan = await interpret(input, {
      classifier: async (candidates) =>
        candidates.map((c) => ({
          sourceHeader: c.sourceHeader,
          sourceCol: c.sourceCol,
          columnDefinitionId: `override-${c.sourceHeader}`,
          confidence: 0.99,
          rationale: "injected",
        })),
      columnDefinitionCatalog: [{ id: "x", label: "x" }],
    });
    const sheet = makeSheetAccessor(input.workbook.sheets[0]);
    const records = extractRecords(plan.regions[0], sheet);
    expect(records).toHaveLength(3);
    expect(records[0].fields["override-email"]).toBe("a@x.com");
    expect(records[0].fields["override-name"]).toBe("alice");
    expect(records[0].fields["override-age"]).toBe(30);
  });

  it("emits PIVOTED_REGION_MISSING_AXIS_NAME when a pivoted region is hinted with an unresolved anchor-cell axisName", async () => {
    const input: InterpretInput = {
      workbook: {
        sheets: [
          {
            name: "Sheet1",
            dimensions: { rows: 2, cols: 3 },
            cells: [
              { row: 1, col: 2, value: "Jan" },
              { row: 1, col: 3, value: "Feb" },
              { row: 2, col: 1, value: "Revenue" },
              { row: 2, col: 2, value: 100 },
              { row: 2, col: 3, value: 200 },
            ],
          },
        ],
      },
      regionHints: [
        {
          sheet: "Sheet1",
          bounds: { startRow: 1, startCol: 1, endRow: 2, endCol: 3 },
          targetEntityDefinitionId: "monthly",
          headerAxes: ["row"],
          segmentsByAxis: {
            row: [
              { kind: "skip", positionCount: 1 },
              {
                kind: "pivot",
                id: "month-seg",
                axisName: "month",
                axisNameSource: "anchor-cell",
                positionCount: 2,
              },
            ],
          },
          cellValueField: { name: "revenue", nameSource: "user" },
        },
      ],
    };
    const plan = await interpret(input);
    const region = plan.regions[0];
    const blocker = region.warnings.find(
      (w) =>
        w.code === "PIVOTED_REGION_MISSING_AXIS_NAME" &&
        w.severity === "blocker"
    );
    expect(blocker).toBeDefined();

    // Replay-bridge: the hinted pivot still emits one record per label even
    // when axis-name resolution produces a blocker warning.
    const sheet = makeSheetAccessor(input.workbook.sheets[0]);
    const records = extractRecords(region, sheet);
    expect(records).toHaveLength(2);
    expect(records.every((r) => r.targetEntityDefinitionId === "monthly")).toBe(
      true
    );
    expect(records.map((r) => r.fields.revenue)).toEqual([100, 200]);
  });
});
