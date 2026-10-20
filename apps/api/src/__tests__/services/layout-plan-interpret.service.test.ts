import { jest, describe, it, expect, beforeEach } from "@jest/globals";

import type { LayoutPlan, RegionHint } from "@portalai/core/contracts";

import type { PermissionSet } from "../../services/permission-set.js";
import { ApiCode } from "../../constants/api-codes.constants.js";

const findByOrganizationId = jest.fn(async () => [
  {
    id: "cd-sys",
    key: "email",
    label: "Email",
    description: null,
    type: "string",
    createdBy: "SYS",
  },
  {
    id: "cd-text",
    key: "text",
    label: "Text",
    description: null,
    type: "string",
    createdBy: "SYS",
  },
  {
    id: "cd-own",
    key: "secret",
    label: "Secret",
    description: "Owner's",
    type: "string",
    createdBy: "OWNER",
  },
]);
const interpret = jest.fn<(...args: unknown[]) => Promise<LayoutPlan>>();

jest.unstable_mockModule("../../services/db.service.js", () => ({
  DbService: {
    repository: { columnDefinitions: { findByOrganizationId } },
  },
}));
jest.unstable_mockModule("@portalai/spreadsheet-parsing", () => ({
  interpret,
}));
jest.unstable_mockModule(
  "../../services/spreadsheet-parsing-llm.service.js",
  () => ({ createInterpretDeps: () => ({}) })
);

const { LayoutPlanInterpretService, scopePlanToCatalog } =
  await import("../../services/layout-plan-interpret.service.js");

/** Reads only system-created column definitions, as a member does. */
const member = {
  can: jest.fn(
    (_action: string, object?: { createdBy?: string }) =>
      object?.createdBy === "SYS"
  ),
} as unknown as PermissionSet;

/** One region binding `bound`, with a pivot segment and cell-value field on
 *  `pivot`. */
const planWith = (bound: string, pivot: string): LayoutPlan =>
  ({
    planVersion: "1.0.0",
    regions: [
      {
        id: "r1",
        columnBindings: [{ columnDefinitionId: bound, confidence: 0.9 }],
        segmentsByAxis: {
          row: [
            { kind: "field", positionCount: 1 },
            {
              kind: "pivot",
              id: "p1",
              axisName: "month",
              axisNameSource: "ai",
              positionCount: 1,
              columnDefinitionId: pivot,
            },
          ],
        },
        cellValueField: { name: "value", columnDefinitionId: pivot },
      },
    ],
  }) as unknown as LayoutPlan;

beforeEach(() => {
  interpret.mockReset();
});

describe("LayoutPlanInterpretService (#834)", () => {
  it("loadCatalog offers the classifier only the column definitions the caller can read", async () => {
    const catalog = await LayoutPlanInterpretService.loadCatalog(
      "org-1",
      member
    );
    expect(findByOrganizationId).toHaveBeenCalledWith("org-1");
    expect(catalog.map((c) => c.id)).toEqual(["cd-sys", "cd-text"]);
    expect(catalog[0]).toEqual({
      id: "cd-sys",
      label: "Email",
      normalizedKey: "email",
      description: undefined,
      type: "string",
    });
  });

  it("analyze refuses a hint naming a column definition the caller can't read, before interpreting", async () => {
    const hint = {
      sheet: "Sheet1",
      bounds: { startRow: 1, startCol: 1, endRow: 2, endCol: 2 },
      targetEntityDefinitionId: "t",
      headerAxes: ["row"],
      cellValueField: { name: "value", columnDefinitionId: "cd-own" },
    } as unknown as RegionHint;

    await expect(
      LayoutPlanInterpretService.analyze(
        { sheets: [] } as never,
        [hint],
        "org-1",
        "u-1",
        member
      )
    ).rejects.toMatchObject({
      status: 404,
      code: ApiCode.COLUMN_DEFINITION_NOT_FOUND,
    });
    expect(interpret).not.toHaveBeenCalled();
  });

  it("analyze replaces an id the classifier returned outside the caller's catalog with the text default", async () => {
    interpret.mockResolvedValue(planWith("cd-own", "cd-made-up"));

    const plan = await LayoutPlanInterpretService.analyze(
      { sheets: [] } as never,
      [],
      "org-1",
      "u-1",
      member
    );

    const region = plan.regions[0] as unknown as ReturnType<
      typeof planWith
    >["regions"][number] & {
      cellValueField: { columnDefinitionId?: string };
    };
    expect(region.columnBindings[0].columnDefinitionId).toBe("cd-text");
    expect(
      (region.segmentsByAxis!.row![1] as { columnDefinitionId?: string })
        .columnDefinitionId
    ).toBe("cd-text");
    expect(region.cellValueField.columnDefinitionId).toBe("cd-text");
  });

  it("scopePlanToCatalog keeps readable ids and, with no default, unbinds the rest", () => {
    const kept = scopePlanToCatalog(
      planWith("cd-sys", "cd-sys"),
      new Set(["cd-sys"]),
      undefined
    );
    expect(kept).toEqual(planWith("cd-sys", "cd-sys"));

    const scoped = scopePlanToCatalog(
      planWith("cd-own", "cd-own"),
      new Set(["cd-sys"]),
      undefined
    ).regions[0] as unknown as {
      columnBindings: Array<{
        columnDefinitionId: string | null;
        excluded?: boolean;
      }>;
      segmentsByAxis: { row: Array<{ columnDefinitionId?: string }> };
      cellValueField: { columnDefinitionId?: string };
    };
    expect(scoped.columnBindings[0]).toMatchObject({
      columnDefinitionId: null,
      excluded: true,
    });
    expect(scoped.segmentsByAxis.row[1]).not.toHaveProperty(
      "columnDefinitionId"
    );
    expect(scoped.cellValueField).not.toHaveProperty("columnDefinitionId");
  });
});
