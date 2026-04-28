import "@testing-library/jest-dom";
import { jest } from "@jest/globals";
import { render, screen, fireEvent } from "@testing-library/react";

import { RegionReviewCardUI } from "../RegionReviewCard.component";
import type { RegionDraft } from "../utils/region-editor.types";

const makeRegion = (
  overrides: Partial<RegionDraft> = {}
): RegionDraft => ({
  id: "region-a",
  sheetId: "sheet_a",
  bounds: { startRow: 0, endRow: 3, startCol: 0, endCol: 2 },
  headerAxes: ["row"],
  segmentsByAxis: { row: [{ kind: "field", positionCount: 3 }] },
  targetEntityDefinitionId: "ent_contact",
  confidence: 0.85,
  columnBindings: [
    {
      sourceLocator: "header:Email",
      columnDefinitionId: "coldef_email",
      columnDefinitionLabel: "Email",
      confidence: 0.9,
    },
    {
      sourceLocator: "col:3",
      columnDefinitionId: "coldef_name",
      columnDefinitionLabel: "Name",
      confidence: 0.7,
      excluded: true,
    },
  ],
  warnings: [],
  ...overrides,
});

function setup(
  overrides: Partial<RegionDraft> = {},
  bindingErrors?: import("../utils/region-editor-validation.util").RegionBindingErrors
) {
  const onJump = jest.fn();
  const onEditBinding =
    jest.fn<(sourceLocator: string, anchorEl: HTMLElement) => void>();
  const utils = render(
    <RegionReviewCardUI
      region={makeRegion(overrides)}
      onJump={onJump}
      onEditBinding={onEditBinding}
      bindingErrors={bindingErrors}
    />
  );
  return { ...utils, onJump, onEditBinding };
}

describe("RegionReviewCardUI — excluded chip styling", () => {
  test("excluded chip carries the 'Excluded' pill", () => {
    setup();
    expect(screen.getByText(/^excluded$/i)).toBeInTheDocument();
  });

  test("excluded chip's aria-label advertises it can be re-enabled", () => {
    setup();
    // Non-excluded chip is labelled with its locator; excluded chip says "Excluded".
    const excludedChip = screen.getByRole("button", {
      name: /excluded.*col:3/i,
    });
    expect(excludedChip).toBeInTheDocument();
  });

  test("clicking a non-excluded chip fires onEditBinding with locator + anchorEl", () => {
    const { onEditBinding } = setup();
    const chip = screen.getByRole("button", {
      name: /edit binding.*header:email/i,
    });
    fireEvent.click(chip);
    expect(onEditBinding).toHaveBeenCalledWith("header:Email", chip);
  });

  test("clicking an excluded chip still fires onEditBinding (re-enable affordance)", () => {
    const { onEditBinding } = setup();
    const chip = screen.getByRole("button", { name: /excluded.*col:3/i });
    fireEvent.click(chip);
    expect(onEditBinding).toHaveBeenCalledWith("col:3", chip);
  });

  test("byHeaderName locator renders the header name as the chip's source label, not the raw locator", () => {
    setup({
      columnBindings: [
        {
          sourceLocator: "header:row:HQ",
          columnDefinitionId: "coldef_hq",
          columnDefinitionLabel: "HQ Office",
          confidence: 0.9,
        },
      ],
    });
    // The source label (HQ from the locator) renders alongside the
    // columnDefinitionLabel ("HQ Office"). The raw "header:row:HQ"
    // string never appears.
    expect(screen.getByText("HQ")).toBeInTheDocument();
    expect(screen.getByText("HQ Office")).toBeInTheDocument();
    expect(screen.queryByText("header:row:HQ")).not.toBeInTheDocument();
  });

  test("byPositionIndex locator with a normalizedKey override renders the override as the chip's source label", () => {
    setup({
      columnBindings: [
        {
          sourceLocator: "pos:row:1",
          columnDefinitionId: "coldef_year",
          columnDefinitionLabel: "Year",
          confidence: 0.9,
          normalizedKey: "year",
        },
      ],
    });
    expect(screen.getByText("year")).toBeInTheDocument();
    expect(screen.queryByText("pos:row:1")).not.toBeInTheDocument();
  });

  test("renders one chip per intersectionCellValueFields entry on a 2D crosstab and skips the region-level cellValueField chip", () => {
    setup({
      headerAxes: ["row", "column"],
      segmentsByAxis: {
        row: [
          { kind: "skip", positionCount: 1 },
          {
            kind: "pivot",
            id: "rp1",
            axisName: "year",
            axisNameSource: "user",
            positionCount: 4,
          },
        ],
        column: [
          { kind: "skip", positionCount: 1 },
          {
            kind: "pivot",
            id: "cp1",
            axisName: "company",
            axisNameSource: "user",
            positionCount: 4,
          },
        ],
      },
      cellValueField: { name: "value", nameSource: "user" },
      intersectionCellValueFields: {
        rp1__cp1: {
          name: "revenue",
          nameSource: "user",
          columnDefinitionId: "coldef_revenue",
        },
      },
      columnBindings: [],
    });
    // Override surfaces as the chip's source label.
    expect(screen.getByText("revenue")).toBeInTheDocument();
    // Region-level "value" default no longer appears on the review card —
    // the override is the canonical name.
    expect(screen.queryByText("value")).not.toBeInTheDocument();
  });

  test("clicking an intersection chip emits the `intersection:<id>` synthetic locator", () => {
    const { onEditBinding } = setup({
      headerAxes: ["row", "column"],
      segmentsByAxis: {
        row: [
          { kind: "skip", positionCount: 1 },
          {
            kind: "pivot",
            id: "rp1",
            axisName: "year",
            axisNameSource: "user",
            positionCount: 4,
          },
        ],
        column: [
          { kind: "skip", positionCount: 1 },
          {
            kind: "pivot",
            id: "cp1",
            axisName: "company",
            axisNameSource: "user",
            positionCount: 4,
          },
        ],
      },
      cellValueField: { name: "value", nameSource: "user" },
      intersectionCellValueFields: {
        rp1__cp1: { name: "revenue", nameSource: "user" },
      },
      columnBindings: [],
    });
    const chip = screen.getByRole("button", {
      name: /edit intersection cell value "revenue"/i,
    });
    fireEvent.click(chip);
    expect(onEditBinding).toHaveBeenCalledWith("intersection:rp1__cp1", chip);
  });

  test("byPositionIndex without a normalizedKey falls back to a positional placeholder", () => {
    setup({
      columnBindings: [
        {
          sourceLocator: "pos:row:2",
          columnDefinitionId: "coldef_other",
          columnDefinitionLabel: "Other",
          confidence: 0.7,
        },
      ],
    });
    // Don't show the raw "pos:row:2" — use a placeholder so the chip
    // still reads as a positional binding.
    expect(screen.queryByText("pos:row:2")).not.toBeInTheDocument();
    expect(screen.getByText(/Pos row 2/i)).toBeInTheDocument();
  });
});

describe("RegionReviewCardUI — pivot + cellValueField chips", () => {
  const pivotRegion: Partial<RegionDraft> = {
    id: "region-pivot",
    bounds: { startRow: 3, endRow: 6, startCol: 1, endCol: 6 },
    headerAxes: ["row"],
    segmentsByAxis: {
      row: [
        {
          kind: "pivot",
          id: "pivot-1",
          axisName: "timestamp",
          axisNameSource: "user",
          positionCount: 6,
          columnDefinitionId: "coldef_timestamp",
        },
      ],
    },
    cellValueField: {
      name: "amount",
      nameSource: "user",
      columnDefinitionId: "coldef_amount",
    },
    columnBindings: [],
  };

  test("renders a chip per pivot segment, resolving the label via resolveColumnLabel", () => {
    const resolveColumnLabel = jest.fn((id: string) =>
      id === "coldef_timestamp"
        ? "Timestamp"
        : id === "coldef_amount"
          ? "Amount"
          : undefined
    );
    render(
      <RegionReviewCardUI
        region={makeRegion(pivotRegion)}
        onJump={jest.fn()}
        onEditBinding={jest.fn()}
        resolveColumnLabel={resolveColumnLabel}
      />
    );
    // Pivot axisName chip: source = "timestamp", label = "Timestamp"
    expect(screen.getByText("timestamp")).toBeInTheDocument();
    expect(screen.getByText("Timestamp")).toBeInTheDocument();
    // CellValueField chip: source = "amount", label = "Amount"
    expect(screen.getByText("amount")).toBeInTheDocument();
    expect(screen.getByText("Amount")).toBeInTheDocument();
  });

  test("clicking a pivot chip fires onEditBinding with a `pivot:<segId>` synthetic locator", () => {
    const onEditBinding =
      jest.fn<(sourceLocator: string, anchorEl: HTMLElement) => void>();
    render(
      <RegionReviewCardUI
        region={makeRegion(pivotRegion)}
        onJump={jest.fn()}
        onEditBinding={onEditBinding}
        resolveColumnLabel={(id) =>
          id === "coldef_timestamp" ? "Timestamp" : "Amount"
        }
      />
    );
    const pivotChip = screen.getByRole("button", {
      name: /edit pivot axis "timestamp"/i,
    });
    fireEvent.click(pivotChip);
    expect(onEditBinding).toHaveBeenCalledWith("pivot:pivot-1", pivotChip);
  });

  test("clicking a cellValueField chip fires onEditBinding with the `cellValueField` synthetic locator", () => {
    const onEditBinding =
      jest.fn<(sourceLocator: string, anchorEl: HTMLElement) => void>();
    render(
      <RegionReviewCardUI
        region={makeRegion(pivotRegion)}
        onJump={jest.fn()}
        onEditBinding={onEditBinding}
        resolveColumnLabel={(id) =>
          id === "coldef_timestamp" ? "Timestamp" : "Amount"
        }
      />
    );
    const cellChip = screen.getByRole("button", {
      name: /edit cell value "amount"/i,
    });
    fireEvent.click(cellChip);
    expect(onEditBinding).toHaveBeenCalledWith("cellValueField", cellChip);
  });

  test("excluded pivot chip shows the 'Excluded' pill and aria-label", () => {
    render(
      <RegionReviewCardUI
        region={makeRegion({
          ...pivotRegion,
          segmentsByAxis: {
            row: [
              {
                kind: "pivot",
                id: "pivot-1",
                axisName: "timestamp",
                axisNameSource: "user",
                positionCount: 6,
                columnDefinitionId: "coldef_timestamp",
                excluded: true,
              },
            ],
          },
        })}
        onJump={jest.fn()}
        onEditBinding={jest.fn()}
        resolveColumnLabel={(id) =>
          id === "coldef_timestamp" ? "Timestamp" : undefined
        }
      />
    );
    expect(
      screen.getByRole("button", {
        name: /excluded.*pivot axis "timestamp"/i,
      })
    ).toBeInTheDocument();
    expect(screen.getByText(/^excluded$/i)).toBeInTheDocument();
  });

  test("excluded cellValueField chip shows the 'Excluded' pill and aria-label", () => {
    render(
      <RegionReviewCardUI
        region={makeRegion({
          ...pivotRegion,
          cellValueField: {
            name: "amount",
            nameSource: "user",
            columnDefinitionId: "coldef_amount",
            excluded: true,
          },
        })}
        onJump={jest.fn()}
        onEditBinding={jest.fn()}
        resolveColumnLabel={(id) =>
          id === "coldef_amount" ? "Amount" : undefined
        }
      />
    );
    expect(
      screen.getByRole("button", {
        name: /excluded.*cell value "amount"/i,
      })
    ).toBeInTheDocument();
  });

  test("unbound pivot segment carries an 'Unbound' pill instead of a confidence dot", () => {
    render(
      <RegionReviewCardUI
        region={makeRegion({
          ...pivotRegion,
          segmentsByAxis: {
            row: [
              {
                kind: "pivot",
                id: "pivot-1",
                axisName: "timestamp",
                axisNameSource: "user",
                positionCount: 6,
                // no columnDefinitionId — classifier didn't find a match.
              },
            ],
          },
          cellValueField: {
            name: "amount",
            nameSource: "user",
            // no columnDefinitionId either.
          },
        })}
        onJump={jest.fn()}
        onEditBinding={jest.fn()}
      />
    );
    expect(screen.getAllByText(/^unbound$/i).length).toBe(2);
  });

  test("non-pivoted region shows no logical-field chips even when resolver is supplied", () => {
    render(
      <RegionReviewCardUI
        region={makeRegion()}
        onJump={jest.fn()}
        onEditBinding={jest.fn()}
        resolveColumnLabel={() => "Anything"}
      />
    );
    // The fixture has no pivot segments and no cellValueField — only the
    // existing columnBindings chips should render.
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });
});

describe("RegionReviewCardUI — invalid chip styling", () => {
  test("chips with entries in bindingErrors carry an invalid aria-label + Invalid pill", () => {
    setup(
      {},
      {
        "header:Email": { normalizedKey: "duplicate override" },
      }
    );
    const invalidChip = screen.getByRole("button", {
      name: /invalid.*header:email/i,
    });
    expect(invalidChip).toBeInTheDocument();
    // Surfaces an "Invalid" pill next to the chip content so the user can spot
    // problem bindings without clicking each one.
    expect(screen.getByText(/^invalid$/i)).toBeInTheDocument();
  });

  test("non-invalid chips are unaffected when bindingErrors is supplied for others", () => {
    setup(
      {},
      {
        "header:Email": { normalizedKey: "duplicate override" },
      }
    );
    // The excluded chip is still labelled "Excluded" (takes precedence in
    // aria-label — excluded bindings don't carry validation errors).
    expect(
      screen.getByRole("button", { name: /excluded.*col:3/i })
    ).toBeInTheDocument();
  });

  test("no bindingErrors prop → no Invalid pills anywhere", () => {
    setup();
    expect(screen.queryByText(/^invalid$/i)).not.toBeInTheDocument();
  });
});
