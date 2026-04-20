import { describe, it, expect } from "@jest/globals";

import type { InterpretInput } from "../../plan/index.js";
import { LayoutPlanSchema } from "../../plan/index.js";
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
        orientation: "rows-as-records",
        headerAxis: "row",
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
    expect(LayoutPlanSchema.safeParse(plan).success).toBe(true);
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

  it("emits PIVOTED_REGION_MISSING_AXIS_NAME when a pivoted region is hinted without a name and the axis-name recommender is disabled", async () => {
    const input: InterpretInput = {
      workbook: {
        sheets: [
          {
            name: "Sheet1",
            dimensions: { rows: 3, cols: 3 },
            cells: [
              { row: 1, col: 1, value: "" },
              { row: 1, col: 2, value: "Jan" },
              { row: 1, col: 3, value: "Feb" },
              { row: 2, col: 1, value: "Revenue" },
              { row: 3, col: 1, value: "Cost" },
            ],
          },
        ],
      },
      regionHints: [
        {
          sheet: "Sheet1",
          bounds: { startRow: 1, startCol: 1, endRow: 3, endCol: 3 },
          targetEntityDefinitionId: "monthly",
          orientation: "columns-as-records",
          headerAxis: "row",
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
  });
});
